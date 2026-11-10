import {
  type Occurrence,
  type OccurrenceRef,
  type SharedExpense,
  type SharedExpenseId,
  type Transaction,
  confirmOccurrence,
  indexAccounts,
  isAwaiting,
  listOccurrences,
  toId,
  validCoverage,
  validateSharedExpense,
  validateTransaction,
} from '@/domain'
import { DataError } from '../../errors'
import { type CommandOptions, type ConfirmOccurrenceInput, type LedgerData, toSnapshotInput } from '../../ports'
import { occurrenceRefSchema, sharedExpenseSchema, transactionSchema } from '../../schemas'
import { confirmInputSchema, parseInput } from '../../validation'
import { type StoreContext, type UnitOfWork, commit } from '../unit-of-work'
import { validationContext } from './support'

interface Located {
  readonly ledger: LedgerData
  readonly occurrence: Occurrence
}

/** The programmed occurrence that `ref` names, with its state as of today. */
async function locate(unit: UnitOfWork, ref: OccurrenceRef): Promise<Located> {
  const ledger = await unit.read.ledger()
  const rule = ledger.rules.find((candidate) => candidate.id === ref.ruleId)
  if (rule === undefined) {
    throw new DataError('not_found', 'El recurrente no existe.')
  }
  const snapshot = toSnapshotInput(ledger, unit.today)
  const occurrence = listOccurrences({
    rules: [rule],
    transactions: ledger.transactions,
    cancelled: ledger.cancelledOccurrences,
    coveredByShared: validCoverage(
      snapshot.sharedCoverage ?? [],
      ledger.rules,
      ledger.meta.memberId,
      ledger.sharedExpenses,
      unit.today,
    ),
    accounts: indexAccounts(ledger.accounts),
    today: unit.today,
    from: ref.dueDate,
    through: ref.dueDate,
  }).find((candidate) => candidate.dueDate === ref.dueDate)
  if (occurrence === undefined) {
    throw new DataError(
      'not_found',
      'Ese movimiento programado no existe: la fecha no corresponde a este recurrente, o está en pausa.',
    )
  }
  return { ledger, occurrence }
}

export function confirmOccurrenceCommand(
  context: StoreContext,
  rawInput: ConfirmOccurrenceInput,
  options?: CommandOptions,
) {
  return commit(context, 'occurrence.confirm', options, rawInput, async (unit) => {
    const input = parseInput(confirmInputSchema, rawInput)
    const ref = parseInput(occurrenceRefSchema, input.ref)
    const { ledger, occurrence } = await locate(unit, ref)
    const validation = await validationContext(unit)
    const me = ledger.meta.memberId

    // Paying a programmed expense that is also a shared one: the shared expense is registered
    // here, together with the cash movement, never in a second step that could be forgotten.
    let sharedExpense: SharedExpense | null = null
    if (input.shared !== undefined) {
      if (occurrence.kind !== 'expense' || occurrence.categoryId === undefined) {
        throw new DataError('invalid_input', 'Solo un gasto programado puede pagarse como gasto compartido.')
      }
      sharedExpense = parseInput(sharedExpenseSchema, {
        id: input.shared.id ?? unit.newId(),
        date: input.date,
        description: input.shared.description,
        categoryId: occurrence.categoryId,
        total: input.amount ?? occurrence.amount,
        payerId: me,
        shares: input.shared.shares,
        authorId: me,
        voided: false,
      })
      validateSharedExpense(
        sharedExpense,
        ledger.members.map((member) => member.id),
      )
    }

    const confirmed = confirmOccurrence(
      occurrence,
      {
        id: toId<'transaction'>(input.transactionId ?? unit.newId()),
        date: input.date,
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.installments !== undefined ? { installments: input.installments } : {}),
        ...(sharedExpense !== null ? { sharedExpenseId: sharedExpense.id } : {}),
      },
      { accounts: validation.accounts, transactions: ledger.transactions, today: unit.today },
    )
    const movement: Transaction = parseInput(
      transactionSchema,
      input.note !== undefined ? { ...confirmed, note: input.note } : confirmed,
    )
    // Once more, now with the categories: the domain function cannot know them.
    validateTransaction(movement, validation)

    if ((await unit.db.transactions.get(movement.id)) !== undefined) {
      throw new DataError('conflict', 'Ya existe un movimiento con ese identificador.')
    }
    if (sharedExpense !== null) {
      await unit.create('sharedExpenses', sharedExpense)
    }
    await unit.create('transactions', movement)
    return { transactionId: movement.id, sharedExpenseId: sharedExpense?.id ?? null }
  })
}

export function skipOccurrence(context: StoreContext, rawRef: OccurrenceRef, options?: CommandOptions) {
  return commit(context, 'occurrence.skip', options, rawRef, async (unit) => {
    const ref = parseInput(occurrenceRefSchema, rawRef)
    const { occurrence } = await locate(unit, ref)
    if (occurrence.status === 'cancelled') {
      return { skipped: true }
    }
    if (!isAwaiting(occurrence)) {
      throw new DataError('conflict', 'Este movimiento programado ya fue confirmado: no se puede saltar.')
    }
    await unit.create('cancelledOccurrences', ref)
    return { skipped: true }
  })
}

export function unskipOccurrence(context: StoreContext, rawRef: OccurrenceRef, options?: CommandOptions) {
  return commit(context, 'occurrence.unskip', options, rawRef, async (unit) => {
    const ref = parseInput(occurrenceRefSchema, rawRef)
    const row = await unit.db.cancelledOccurrences.get([ref.ruleId, ref.dueDate])
    if (row !== undefined) {
      await unit.remove('cancelledOccurrences', row)
    }
    return { skipped: false }
  })
}

export function coverOccurrence(
  context: StoreContext,
  rawRef: OccurrenceRef,
  sharedExpenseId: SharedExpenseId,
  options?: CommandOptions,
) {
  return commit(context, 'occurrence.cover', options, { ref: rawRef, sharedExpenseId }, async (unit) => {
    const ref = parseInput(occurrenceRefSchema, rawRef)
    const { ledger, occurrence } = await locate(unit, ref)
    const existing = await unit.db.coverages.get([ref.ruleId, ref.dueDate])
    if (existing?.sharedExpenseId === sharedExpenseId) {
      return { covered: true }
    }
    // Still waiting, or covered by another shared expense: pointing it at a different one is allowed.
    const open = isAwaiting(occurrence) || occurrence.sharedExpenseId !== undefined
    if (!open) {
      throw new DataError('conflict', 'Este movimiento programado ya fue confirmado o saltado.')
    }
    const coverage = { ruleId: ref.ruleId, dueDate: ref.dueDate, sharedExpenseId }
    const holds = validCoverage(
      [{ ref, sharedExpenseId }],
      ledger.rules,
      ledger.meta.memberId,
      ledger.sharedExpenses,
      unit.today,
    )
    if (holds.length !== 1) {
      throw new DataError(
        'invalid_input',
        'Ese gasto compartido no puede cubrir este programado: debe ser de la misma categoría, haberlo pagado otra persona e incluirte.',
      )
    }
    const usedElsewhere = await unit.db.coverages.where('sharedExpenseId').equals(sharedExpenseId).first()
    if (usedElsewhere !== undefined) {
      throw new DataError('conflict', 'Ese gasto compartido ya cubre otro movimiento programado.')
    }
    if (existing !== undefined) {
      await unit.replace('coverages', existing, coverage)
    } else {
      await unit.create('coverages', coverage)
    }
    return { covered: true }
  })
}

export function uncoverOccurrence(context: StoreContext, rawRef: OccurrenceRef, options?: CommandOptions) {
  return commit(context, 'occurrence.uncover', options, rawRef, async (unit) => {
    const ref = parseInput(occurrenceRefSchema, rawRef)
    const row = await unit.db.coverages.get([ref.ruleId, ref.dueDate])
    if (row !== undefined) {
      await unit.remove('coverages', row)
    }
    return { covered: false }
  })
}
