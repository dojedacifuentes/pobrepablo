import { type AccountIndex, requireAccount } from './accounts'
import { defaultInstallmentPlan } from './credit-card'
import { type LocalDate, addDays, addMonthsAnchored, compareDates, maxDate } from './dates'
import { DomainError, invariant } from './errors'
import {
  type AccountId,
  type CategoryId,
  type RuleId,
  type SharedExpenseId,
  type TransactionId,
  compareIds,
} from './ids'
import type { Money } from './money'
import { type OccurrenceRef, type Transaction, occurrenceOf, validateTransaction } from './transactions'

export type Frequency = 'weekly' | 'monthly' | 'yearly'

/**
 * A rule that programmes movements: rent every month, a salary, a subscription.
 * `startDate` is the anchor: monthly rules keep its day of the month, shortened in short months.
 *
 * The schedule of a rule (start, frequency, interval) is never edited in place, because its
 * occurrences are identified by their dates: moving the dates would orphan what was already
 * confirmed. To change the schedule, use `rescheduleRule`.
 */
export interface RecurringRule {
  readonly id: RuleId
  readonly kind: 'expense' | 'income' | 'transfer'
  readonly label: string
  readonly amount: Money
  /** True when the amount changes every time (the electricity bill) and this is only a guess. */
  readonly amountIsEstimate: boolean
  readonly accountId: AccountId
  /** Transfers only. */
  readonly toAccountId?: AccountId
  /** Expenses and income only. */
  readonly categoryId?: CategoryId
  readonly frequency: Frequency
  /** Every `interval` weeks, months or years. Fortnightly is weekly with interval 2. */
  readonly interval: number
  readonly startDate: LocalDate
  readonly endDate?: LocalDate
  /** A paused rule programmes nothing that is still waiting; what was confirmed stays in the history. */
  readonly paused: boolean
}

export type OccurrenceStatus = 'pending' | 'confirmed' | 'overdue' | 'estimated' | 'cancelled'

/** One programmed movement of a rule, with its current state. */
export interface Occurrence {
  readonly ruleId: RuleId
  readonly dueDate: LocalDate
  readonly kind: RecurringRule['kind']
  readonly label: string
  /** The rule's amount, or the real amount once confirmed by a movement. */
  readonly amount: Money
  readonly amountIsEstimate: boolean
  readonly status: OccurrenceStatus
  readonly accountId: AccountId
  readonly toAccountId?: AccountId
  readonly categoryId?: CategoryId
  /** Present when it was confirmed by a real movement. */
  readonly transactionId?: TransactionId
  /** Present when it was covered by a shared expense that somebody else paid. */
  readonly sharedExpenseId?: SharedExpenseId
}

/**
 * Says that a programmed expense was taken care of by a shared household expense paid by somebody
 * else: the rent that the other member paid in full. The occurrence stops being an obligation;
 * what is owed for it is now the internal household debt, so it is never counted twice.
 */
export interface OccurrenceCoverage {
  readonly ref: OccurrenceRef
  readonly sharedExpenseId: SharedExpenseId
}

const MAX_OCCURRENCES_PER_RULE = 2000

export function validateRule(rule: RecurringRule): void {
  invariant(rule.amount > 0, 'El monto de un recurrente debe ser mayor que cero')
  invariant(Number.isInteger(rule.interval) && rule.interval >= 1, 'El intervalo debe ser un entero mayor que cero')
  invariant(rule.endDate === undefined || rule.endDate >= rule.startDate, 'La fecha de término es anterior al inicio')
  if (rule.kind === 'transfer') {
    invariant(rule.toAccountId !== undefined, 'Una transferencia recurrente necesita cuenta de destino')
    invariant(rule.toAccountId !== rule.accountId, 'Una transferencia necesita dos cuentas distintas')
  } else {
    invariant(rule.categoryId !== undefined, 'Un gasto o ingreso recurrente necesita categoría')
  }
}

function occurrenceNumber(rule: RecurringRule, index: number): LocalDate {
  switch (rule.frequency) {
    case 'weekly':
      return addDays(rule.startDate, 7 * rule.interval * index)
    case 'monthly':
      return addMonthsAnchored(rule.startDate, rule.interval * index)
    case 'yearly':
      return addMonthsAnchored(rule.startDate, 12 * rule.interval * index)
  }
}

/** The dates a rule falls on between `from` and `through` (both included). */
export function occurrenceDates(rule: RecurringRule, from: LocalDate, through: LocalDate): LocalDate[] {
  invariant(Number.isInteger(rule.interval) && rule.interval >= 1, 'El intervalo debe ser un entero mayor que cero')
  const last = rule.endDate !== undefined && rule.endDate < through ? rule.endDate : through
  const dates: LocalDate[] = []
  for (let index = 0; index < MAX_OCCURRENCES_PER_RULE; index += 1) {
    if (rule.startDate > last) {
      break
    }
    const date = occurrenceNumber(rule, index)
    if (date > last) {
      break
    }
    if (date >= from) {
      dates.push(date)
    }
  }
  return dates
}

function refKey(ref: OccurrenceRef): string {
  return `${ref.ruleId}\u0000${ref.dueDate}`
}

export interface ListOccurrencesInput {
  readonly rules: readonly RecurringRule[]
  readonly transactions: readonly Transaction[]
  /** Occurrences the person decided to skip. */
  readonly cancelled: readonly OccurrenceRef[]
  /** Occurrences taken care of by a shared expense that another member paid. */
  readonly coveredByShared?: readonly OccurrenceCoverage[]
  readonly accounts: AccountIndex
  readonly today: LocalDate
  /** Defaults to each rule's start. */
  readonly from?: LocalDate
  readonly through: LocalDate
}

/** A rule cannot owe anything from before its accounts existed: their opening balance includes it. */
function firstPossibleDate(rule: RecurringRule, accounts: AccountIndex, from: LocalDate | undefined): LocalDate {
  let first = maxDate(from ?? rule.startDate, requireAccount(accounts, rule.accountId).openingDate)
  if (rule.toAccountId !== undefined) {
    first = maxDate(first, requireAccount(accounts, rule.toAccountId).openingDate)
  }
  return first
}

/**
 * Every programmed movement up to `through`, with its state:
 * confirmed (a real movement dated today or earlier took its place, or a shared expense covered
 * it), cancelled (skipped), overdue (its date passed and nothing was registered), estimated
 * (future, variable amount) or pending (future, known amount).
 */
export function listOccurrences(input: ListOccurrencesInput): Occurrence[] {
  const confirmedBy = new Map<string, Transaction>()
  for (const transaction of input.transactions) {
    // A movement dated in the future has not happened: it cannot settle anything yet.
    if (transaction.voided || transaction.date > input.today) {
      continue
    }
    const ref = occurrenceOf(transaction)
    if (ref !== undefined && !confirmedBy.has(refKey(ref))) {
      confirmedBy.set(refKey(ref), transaction)
    }
  }
  const cancelled = new Set(input.cancelled.map(refKey))
  const covered = new Map((input.coveredByShared ?? []).map((coverage) => [refKey(coverage.ref), coverage]))

  const occurrences: Occurrence[] = []
  for (const rule of input.rules) {
    const from = firstPossibleDate(rule, input.accounts, input.from)
    for (const dueDate of occurrenceDates(rule, from, input.through)) {
      const key = refKey({ ruleId: rule.id, dueDate })
      const confirmation = confirmedBy.get(key)
      // Only an expense can be covered by a shared expense.
      const coverage = confirmation === undefined && rule.kind === 'expense' ? covered.get(key) : undefined

      let status: OccurrenceStatus
      if (confirmation !== undefined || coverage !== undefined) {
        status = 'confirmed'
      } else if (cancelled.has(key)) {
        status = 'cancelled'
      } else if (rule.paused) {
        continue
      } else if (dueDate < input.today) {
        status = 'overdue'
      } else {
        status = rule.amountIsEstimate ? 'estimated' : 'pending'
      }

      occurrences.push({
        ruleId: rule.id,
        dueDate,
        kind: rule.kind,
        label: rule.label,
        amount: confirmation?.amount ?? rule.amount,
        amountIsEstimate: status !== 'confirmed' && rule.amountIsEstimate,
        status,
        accountId: rule.accountId,
        ...(rule.toAccountId !== undefined ? { toAccountId: rule.toAccountId } : {}),
        ...(rule.categoryId !== undefined ? { categoryId: rule.categoryId } : {}),
        ...(confirmation !== undefined ? { transactionId: confirmation.id } : {}),
        ...(coverage !== undefined ? { sharedExpenseId: coverage.sharedExpenseId } : {}),
      })
    }
  }

  return occurrences.sort((a, b) => compareDates(a.dueDate, b.dueDate) || compareIds(a.ruleId, b.ruleId))
}

/** True while the occurrence is still waiting: it has not been confirmed nor skipped. */
export function isAwaiting(occurrence: Occurrence): boolean {
  return occurrence.status === 'pending' || occurrence.status === 'overdue' || occurrence.status === 'estimated'
}

/** True when a live movement (whatever its date) already confirms that occurrence. */
export function isConfirmedByMovement(ref: OccurrenceRef, transactions: readonly Transaction[]): boolean {
  const key = refKey(ref)
  return transactions.some((transaction) => {
    if (transaction.voided) {
      return false
    }
    const other = occurrenceOf(transaction)
    return other !== undefined && refKey(other) === key
  })
}

export interface ConfirmationDetails {
  readonly id: TransactionId
  /** The day the money really moved. Never in the future. */
  readonly date: LocalDate
  /** The real amount, when it differs from the programmed one. */
  readonly amount?: Money
  /** Credit-card expenses only: how many instalments. One by default. */
  readonly installments?: number
  /**
   * Expenses only: the payment is the cash side of this shared household expense. The movement is
   * then a `shared_payment`, so the person's expense is only their own share.
   */
  readonly sharedExpenseId?: SharedExpenseId
}

export interface ConfirmationContext {
  readonly accounts: AccountIndex
  /** The movements as they are right now: this is what stops a double confirmation. */
  readonly transactions: readonly Transaction[]
  readonly today: LocalDate
}

/**
 * Turns a programmed occurrence into a real movement. The movement remembers which occurrence it
 * confirms, so the same occurrence can never be counted twice: a second confirmation is rejected.
 *
 * A credit-card expense gets its instalment plan here, so that it falls due on the card's bill
 * exactly as it was announced while it was still pending.
 */
export function confirmOccurrence(
  occurrence: Occurrence,
  details: ConfirmationDetails,
  context: ConfirmationContext,
): Transaction {
  const ref: OccurrenceRef = { ruleId: occurrence.ruleId, dueDate: occurrence.dueDate }
  if (!isAwaiting(occurrence) || isConfirmedByMovement(ref, context.transactions)) {
    throw new DomainError('Este movimiento programado ya fue confirmado o cancelado')
  }

  const base = {
    id: details.id,
    date: details.date,
    amount: details.amount ?? occurrence.amount,
    voided: false,
    occurrence: ref,
  }

  const account = requireAccount(context.accounts, occurrence.accountId)
  invariant(
    details.installments === undefined || (occurrence.kind === 'expense' && account.kind === 'credit_card'),
    'Solo un gasto con cargo a una tarjeta de crédito puede ir en cuotas',
  )

  let transaction: Transaction
  if (occurrence.kind === 'transfer') {
    invariant(occurrence.toAccountId !== undefined, 'La transferencia programada no tiene cuenta de destino')
    invariant(details.sharedExpenseId === undefined, 'Solo un gasto puede pagarse como gasto compartido')
    transaction = {
      ...base,
      kind: 'transfer',
      fromAccountId: occurrence.accountId,
      toAccountId: occurrence.toAccountId,
    }
  } else if (occurrence.kind === 'income') {
    invariant(occurrence.categoryId !== undefined, 'El ingreso programado no tiene categoría')
    invariant(details.sharedExpenseId === undefined, 'Solo un gasto puede pagarse como gasto compartido')
    transaction = { ...base, kind: 'income', accountId: occurrence.accountId, categoryId: occurrence.categoryId }
  } else {
    const plan =
      account.kind === 'credit_card'
        ? { installments: defaultInstallmentPlan(account, details.date, details.installments ?? 1) }
        : {}
    if (details.sharedExpenseId !== undefined) {
      transaction = {
        ...base,
        ...plan,
        kind: 'shared_payment',
        accountId: occurrence.accountId,
        sharedExpenseId: details.sharedExpenseId,
      }
    } else {
      invariant(occurrence.categoryId !== undefined, 'El gasto programado no tiene categoría')
      transaction = {
        ...base,
        ...plan,
        kind: 'expense',
        accountId: occurrence.accountId,
        categoryId: occurrence.categoryId,
      }
    }
  }

  validateTransaction(transaction, { accounts: context.accounts, today: context.today })
  return transaction
}

/** Occurrences confirmed by more than one live movement. Must always be empty. */
export function duplicateConfirmations(transactions: readonly Transaction[]): OccurrenceRef[] {
  const seen = new Set<string>()
  const reported = new Set<string>()
  const duplicates: OccurrenceRef[] = []
  for (const transaction of transactions) {
    if (transaction.voided) {
      continue
    }
    const ref = occurrenceOf(transaction)
    if (ref === undefined) {
      continue
    }
    const key = refKey(ref)
    if (seen.has(key) && !reported.has(key)) {
      reported.add(key)
      duplicates.push(ref)
    }
    seen.add(key)
  }
  return duplicates
}

export type ScheduleChange = Partial<
  Pick<
    RecurringRule,
    'label' | 'amount' | 'amountIsEstimate' | 'accountId' | 'toAccountId' | 'categoryId' | 'frequency' | 'interval' | 'endDate'
  >
>

/**
 * Changes the schedule of a rule without touching its past.
 *
 * The existing rule is closed on `lastDayOfOld` and a new rule, with its own id, starts on
 * `next.startDate`. Everything already confirmed, skipped or still overdue under the old rule
 * keeps its identity; only what comes after follows the new schedule.
 */
export function rescheduleRule(
  rule: RecurringRule,
  lastDayOfOld: LocalDate,
  next: { readonly id: RuleId; readonly startDate: LocalDate } & ScheduleChange,
  /** The movements as they are now: a payment already made for a later date blocks the cut. */
  transactions: readonly Transaction[] = [],
): { readonly closed: RecurringRule; readonly next: RecurringRule } {
  invariant(lastDayOfOld >= rule.startDate, 'La regla anterior debe conservar al menos su primera fecha')
  invariant(next.startDate > lastDayOfOld, 'La regla nueva debe empezar después de que termine la anterior')
  invariant(next.id !== rule.id, 'La regla nueva necesita un identificador distinto')
  invariant(
    !transactions.some((transaction) => {
      const ref = transaction.voided ? undefined : occurrenceOf(transaction)
      return ref !== undefined && ref.ruleId === rule.id && ref.dueDate > lastDayOfOld
    }),
    'Ya hay un pago confirmado para una fecha posterior al corte: elige un corte más adelante',
  )
  // Closing never extends a rule that had already ended earlier.
  const endDate = rule.endDate !== undefined && rule.endDate < lastDayOfOld ? rule.endDate : lastDayOfOld
  const closed: RecurringRule = { ...rule, endDate }
  // The new rule keeps the old end only if that end is still ahead of its own start.
  const { endDate: previousEnd, ...withoutEnd } = rule
  const inheritedEnd = previousEnd !== undefined && previousEnd >= next.startDate ? { endDate: previousEnd } : {}
  const replacement: RecurringRule = { ...withoutEnd, ...inheritedEnd, ...next }
  validateRule(closed)
  validateRule(replacement)
  return { closed, next: replacement }
}
