import {
  type InstallmentPlan,

  type PaymentDetails,
  type SettlementId,
  type SharedExpenseId,
  type Transaction,
  defaultInstallmentPlan,
  recordSettlement,
  recordSharedExpense,
  requireAccount,
  toId,
  validateSettlement,
  validateSharedExpense,
  validateTransaction,
  voidSettlement,
  voidSharedExpense,
} from '@/domain'
import { DataError } from '../../errors'
import { registeringSince } from '../../ledger-issues'
import type { CommandOptions, NewSettlement, NewSharedExpense } from '../../ports'
import type { JsonValue } from '../../records'
import { settingRecordSchema, settlementSchema, sharedExpenseSchema } from '../../schemas'
import { parseInput, settlementInputSchema, sharedExpenseInputSchema } from '../../validation'
import { type StoreContext, type UnitOfWork, commit } from '../unit-of-work'
import { found, notInFuture, requireCategory, validationContext, withoutMeta } from './support'

/**
 * The household keeps pairs of records that must be born and voided together: a shared expense
 * with the cash that paid it, a reimbursement with its account movement. Every operation here
 * writes both sides in the same transaction, and the unit of work re-checks the whole household
 * ledger (`householdLedgerIssues`) before anything is committed.
 */

async function household(unit: UnitOfWork) {
  const profile = await unit.read.profile()
  const members = (await unit.read.members()).map((member) => member.id)
  return { me: profile.memberId, since: registeringSince(profile, await unit.read.accounts()), members }
}

export function recordSharedExpenseCommand(
  context: StoreContext,
  rawInput: NewSharedExpense,
  options?: CommandOptions,
) {
  return commit(context, 'shared_expense.create', options, rawInput, async (unit) => {
    const input = parseInput(sharedExpenseInputSchema, rawInput)
    const { me, since, members } = await household(unit)
    const validation = await validationContext(unit)

    const expense = parseInput(sharedExpenseSchema, {
      id: input.id ?? unit.newId(),
      date: input.date,
      description: input.description,
      categoryId: input.categoryId,
      total: input.total,
      payerId: input.payerId,
      shares: input.shares,
      authorId: me,
      voided: false,
    })
    validateSharedExpense(expense, members)
    requireCategory(validation.categories, expense.categoryId, 'expense')
    notInFuture(expense.date, unit.today, 'Un gasto compartido')

    let payment: PaymentDetails | undefined
    if (input.payment !== undefined) {
      const account = requireAccount(validation.accounts, toId<'account'>(input.payment.accountId))
      if (input.payment.installments !== undefined && account.kind !== 'credit_card') {
        throw new DataError('invalid_input', 'Solo una compra con tarjeta de crédito puede ir en cuotas.')
      }
      const plan: { installments?: InstallmentPlan } =
        account.kind === 'credit_card'
          ? { installments: defaultInstallmentPlan(account, expense.date, input.payment.installments ?? 1) }
          : {}
      payment = {
        id: toId<'transaction'>(input.payment.transactionId ?? unit.newId()),
        accountId: account.id,
        ...plan,
      }
    }

    // Something this person paid before they started registering left no trace in their accounts:
    // the opening balances already include it, so only the internal debt is stored.
    const beforeRegistering = expense.payerId === me && payment === undefined && expense.date < since
    const recorded = beforeRegistering
      ? { expense, payment: null }
      : recordSharedExpense(expense, me, payment, validation)

    await unit.create('sharedExpenses', recorded.expense)
    if (recorded.payment !== null) {
      await unit.create('transactions', recorded.payment)
    }
    return { sharedExpenseId: expense.id, transactionId: recorded.payment?.id ?? null }
  })
}

async function voidPair<R extends JsonValue>(
  unit: UnitOfWork,
  changed: readonly Transaction[],
  result: R,
): Promise<R> {
  for (const transaction of changed) {
    const before = await found(unit.db.transactions.get(transaction.id), 'El movimiento no existe.')
    await unit.replace('transactions', before, transaction, 'void')
  }
  return result
}

export function voidSharedExpenseCommand(context: StoreContext, id: SharedExpenseId, options?: CommandOptions) {
  return commit(context, 'shared_expense.void', options, { id }, async (unit) => {
    const before = await found(unit.db.sharedExpenses.get(id), 'El gasto compartido no existe.')
    if (before.voided) {
      return { sharedExpenseId: id }
    }
    const { expense, transactions } = voidSharedExpense(withoutMeta(before), await unit.read.transactions())
    await unit.replace('sharedExpenses', before, expense, 'void')
    return voidPair(unit, transactions, { sharedExpenseId: id })
  })
}

export function recordSettlementCommand(context: StoreContext, rawInput: NewSettlement, options?: CommandOptions) {
  return commit(context, 'settlement.create', options, rawInput, async (unit) => {
    const input = parseInput(settlementInputSchema, rawInput)
    const { me, since, members } = await household(unit)
    const validation = await validationContext(unit)

    const settlement = parseInput(settlementSchema, {
      id: input.id ?? unit.newId(),
      date: input.date,
      fromMemberId: input.fromMemberId,
      toMemberId: input.toMemberId,
      amount: input.amount,
      authorId: me,
      voided: false,
    })
    validateSettlement(settlement, members)
    notInFuture(settlement.date, unit.today, 'Un reembolso')

    const involved = settlement.fromMemberId === me || settlement.toMemberId === me
    const beforeRegistering = involved && input.movement === undefined && settlement.date < since
    const recorded = beforeRegistering
      ? { settlement, movement: null }
      : recordSettlement(
          settlement,
          me,
          input.movement !== undefined
            ? {
                id: toId<'transaction'>(input.movement.transactionId ?? unit.newId()),
                accountId: toId<'account'>(input.movement.accountId),
              }
            : undefined,
        )
    if (recorded.movement !== null) {
      validateTransaction(recorded.movement, validation)
    }

    await unit.create('settlements', recorded.settlement)
    if (recorded.movement !== null) {
      await unit.create('transactions', recorded.movement)
    }
    return { settlementId: settlement.id, transactionId: recorded.movement?.id ?? null }
  })
}

export function voidSettlementCommand(context: StoreContext, id: SettlementId, options?: CommandOptions) {
  return commit(context, 'settlement.void', options, { id }, async (unit) => {
    const before = await found(unit.db.settlements.get(id), 'El reembolso no existe.')
    if (before.voided) {
      return { settlementId: id }
    }
    const { settlement, transactions } = voidSettlement(withoutMeta(before), await unit.read.transactions())
    await unit.replace('settlements', before, settlement, 'void')
    return voidPair(unit, transactions, { settlementId: id })
  })
}

export function setSetting(context: StoreContext, key: string, value: JsonValue, options?: CommandOptions) {
  return commit(context, 'setting.set', options, { key, value }, async (unit) => {
    // A value JSON cannot carry (`undefined`, a function) would be stored and then break every backup.
    const setting = parseInput(settingRecordSchema, { key, value, updatedAt: unit.now })
    const before = await unit.db.settings.get(setting.key)
    if (before === undefined || JSON.stringify(before.value) !== JSON.stringify(setting.value)) {
      await unit.putSetting(before, setting)
    }
    return { key: setting.key }
  })
}
