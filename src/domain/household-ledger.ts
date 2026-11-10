import type { LocalDate } from './dates'
import { invariant } from './errors'
import type { Settlement, SharedExpense } from './household'
import type { AccountId, MemberId, SettlementId, SharedExpenseId, TransactionId } from './ids'
import {
  type InstallmentPlan,
  type OccurrenceRef,
  type SettlementMovement,
  type SharedPayment,
  type Transaction,
  type ValidationContext,
  validateTransaction,
} from './transactions'

/**
 * The household keeps two kinds of records that must always travel together:
 *
 * - a `SharedExpense` (what the household spent and how it is split) and, on the phone of whoever
 *   paid, the `shared_payment` movement (the cash that left their account);
 * - a `Settlement` (a reimbursement between two members) and, on the phones of both, the
 *   `settlement` movement (the cash that left or entered an account).
 *
 * Creating or voiding one side without the other makes money appear or disappear. These functions
 * always produce both sides, and `householdLedgerIssues` finds any pair that came apart.
 */

export interface PaymentDetails {
  readonly id: TransactionId
  readonly accountId: AccountId
  readonly installments?: InstallmentPlan
  readonly occurrence?: OccurrenceRef
}

/**
 * Registers a shared expense as seen from `me`'s phone. When `me` is who paid, the cash movement
 * is created with it, for exactly the total and on the same day. When somebody else paid, no
 * account of `me` moves: only the internal debt appears.
 */
export function recordSharedExpense(
  expense: SharedExpense,
  me: MemberId,
  payment?: PaymentDetails,
  /** When given, the cash movement is validated like any other (date, account, instalments). */
  context?: ValidationContext,
): { readonly expense: SharedExpense; readonly payment: SharedPayment | null } {
  if (expense.payerId !== me) {
    invariant(payment === undefined, 'Solo quien pagó registra la salida de dinero de su cuenta')
    return { expense, payment: null }
  }
  invariant(payment !== undefined, 'Quien pagó debe indicar de qué cuenta salió el dinero')
  const movement: SharedPayment = {
    kind: 'shared_payment',
    id: payment.id,
    date: expense.date,
    amount: expense.total,
    accountId: payment.accountId,
    sharedExpenseId: expense.id,
    voided: false,
    ...(payment.installments !== undefined ? { installments: payment.installments } : {}),
    ...(payment.occurrence !== undefined ? { occurrence: payment.occurrence } : {}),
  }
  if (context !== undefined) {
    validateTransaction(movement, context)
  }
  return { expense, payment: movement }
}

/** Voids a shared expense together with the cash movement that paid it. Returns only what changed. */
export function voidSharedExpense(
  expense: SharedExpense,
  transactions: readonly Transaction[],
): { readonly expense: SharedExpense; readonly transactions: Transaction[] } {
  return {
    expense: { ...expense, voided: true },
    transactions: transactions
      .filter(
        (transaction) =>
          transaction.kind === 'shared_payment' && transaction.sharedExpenseId === expense.id && !transaction.voided,
      )
      .map((transaction) => ({ ...transaction, voided: true })),
  }
}

/**
 * Registers a reimbursement as seen from `me`'s phone. When `me` gave or received the money, the
 * cash movement is created with it.
 */
export function recordSettlement(
  settlement: Settlement,
  me: MemberId,
  movement?: { readonly id: TransactionId; readonly accountId: AccountId },
): { readonly settlement: Settlement; readonly movement: SettlementMovement | null } {
  const involved = settlement.fromMemberId === me || settlement.toMemberId === me
  if (!involved) {
    invariant(movement === undefined, 'Este reembolso es entre otras personas: no mueve ninguna cuenta propia')
    return { settlement, movement: null }
  }
  invariant(movement !== undefined, 'Falta indicar la cuenta por la que pasó el reembolso')
  return {
    settlement,
    movement: {
      kind: 'settlement',
      id: movement.id,
      date: settlement.date,
      amount: settlement.amount,
      accountId: movement.accountId,
      direction: settlement.fromMemberId === me ? 'paid' : 'received',
      settlementId: settlement.id,
      voided: false,
    },
  }
}

/** Voids a reimbursement together with its cash movement. Returns only what changed. */
export function voidSettlement(
  settlement: Settlement,
  transactions: readonly Transaction[],
): { readonly settlement: Settlement; readonly transactions: Transaction[] } {
  return {
    settlement: { ...settlement, voided: true },
    transactions: transactions
      .filter(
        (transaction) =>
          transaction.kind === 'settlement' && transaction.settlementId === settlement.id && !transaction.voided,
      )
      .map((transaction) => ({ ...transaction, voided: true })),
  }
}

export type LedgerIssueKind =
  /** Cash left an account for a shared expense that does not exist or was voided. */
  | 'payment_without_expense'
  /** The cash movement belongs to an expense that somebody else paid. */
  | 'payment_by_non_payer'
  /** The cash movement and the shared expense disagree on the amount or the day. */
  | 'payment_mismatch'
  /** `me` paid a shared expense but no cash movement shows it leaving an account. */
  | 'expense_without_payment'
  /** More than one cash movement pays the same shared expense. */
  | 'duplicate_payment'
  | 'movement_without_settlement'
  | 'movement_mismatch'
  | 'settlement_without_movement'
  | 'duplicate_movement'

export interface LedgerIssue {
  readonly kind: LedgerIssueKind
  readonly transactionId?: TransactionId
  readonly sharedExpenseId?: SharedExpenseId
  readonly settlementId?: SettlementId
}

/**
 * Every pair of household records that came apart on `me`'s phone. An empty list means that the
 * personal movements and the household events tell the same story. The data layer checks this
 * before storing, and an imported package that breaks it must be shown to the person.
 */
export function householdLedgerIssues(
  me: MemberId,
  transactions: readonly Transaction[],
  expenses: readonly SharedExpense[],
  settlements: readonly Settlement[],
  /**
   * The day `me` started registering. Household events older than that have no cash movement on
   * this phone and none is expected: the opening balances already include them.
   */
  since?: LocalDate,
): LedgerIssue[] {
  const expected = (date: LocalDate): boolean => since === undefined || date >= since
  const issues: LedgerIssue[] = []
  const liveExpenses = new Map(expenses.filter((expense) => !expense.voided).map((expense) => [expense.id, expense]))
  const liveSettlements = new Map(
    settlements.filter((settlement) => !settlement.voided).map((settlement) => [settlement.id, settlement]),
  )
  const paidExpenses = new Set<SharedExpenseId>()
  const movedSettlements = new Set<SettlementId>()

  for (const transaction of transactions) {
    if (transaction.voided) {
      continue
    }
    if (transaction.kind === 'shared_payment') {
      const reference = { transactionId: transaction.id, sharedExpenseId: transaction.sharedExpenseId }
      const expense = liveExpenses.get(transaction.sharedExpenseId)
      if (expense === undefined) {
        issues.push({ kind: 'payment_without_expense', ...reference })
        continue
      }
      if (expense.payerId !== me) {
        issues.push({ kind: 'payment_by_non_payer', ...reference })
      } else if (paidExpenses.has(expense.id)) {
        issues.push({ kind: 'duplicate_payment', ...reference })
      } else if (transaction.amount !== expense.total || transaction.date !== expense.date) {
        issues.push({ kind: 'payment_mismatch', ...reference })
      }
      paidExpenses.add(expense.id)
    } else if (transaction.kind === 'settlement') {
      const reference = { transactionId: transaction.id, settlementId: transaction.settlementId }
      const settlement = liveSettlements.get(transaction.settlementId)
      if (settlement === undefined) {
        issues.push({ kind: 'movement_without_settlement', ...reference })
        continue
      }
      const expectedDirection =
        settlement.fromMemberId === me ? 'paid' : settlement.toMemberId === me ? 'received' : null
      if (movedSettlements.has(settlement.id)) {
        issues.push({ kind: 'duplicate_movement', ...reference })
      } else if (
        expectedDirection !== transaction.direction ||
        transaction.amount !== settlement.amount ||
        transaction.date !== settlement.date
      ) {
        issues.push({ kind: 'movement_mismatch', ...reference })
      }
      movedSettlements.add(settlement.id)
    }
  }

  for (const expense of liveExpenses.values()) {
    if (expense.payerId === me && !paidExpenses.has(expense.id) && expected(expense.date)) {
      issues.push({ kind: 'expense_without_payment', sharedExpenseId: expense.id })
    }
  }
  for (const settlement of liveSettlements.values()) {
    const involved = settlement.fromMemberId === me || settlement.toMemberId === me
    if (involved && !movedSettlements.has(settlement.id) && expected(settlement.date)) {
      issues.push({ kind: 'settlement_without_movement', settlementId: settlement.id })
    }
  }
  return issues
}
