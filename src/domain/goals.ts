import { type AccountIndex, accountClass, requireAccount } from './accounts'
import { type LocalDate, compareDates, yearMonthOf, yearMonthParts } from './dates'
import { invariant } from './errors'
import { type AccountId, type GoalId, type ReservationId, type TransactionId, compareIds } from './ids'
import { type Money, ZERO, add, atLeastZero, mulDivFloor, negate, subtract } from './money'
import { type Transaction, type Transfer, validateTransaction } from './transactions'

export interface Goal {
  readonly id: GoalId
  readonly name: string
  readonly target: Money
  readonly targetDate?: LocalDate
  readonly archived: boolean
}

/**
 * Money set apart for a goal while it stays in the same account. Positive reserves, negative
 * releases. It changes no account balance; it only stops counting as available to spend.
 *
 * The other way to save is an effective transfer to a savings account, marked with the goal:
 * that one does change account balances.
 */
export interface GoalReservation {
  readonly id: ReservationId
  readonly goalId: GoalId
  readonly date: LocalDate
  readonly amount: Money
  readonly voided: boolean
}

export interface GoalProgress {
  readonly goalId: GoalId
  /** Still in a spendable account, but set apart. */
  readonly reserved: Money
  /** Effectively moved to a savings account. */
  readonly transferred: Money
  readonly accumulated: Money
  readonly remaining: Money
  /** Whole percentage, capped at 100. */
  readonly percent: number
  readonly reached: boolean
}

export function validateGoal(goal: Goal): void {
  invariant(goal.name.trim().length > 0, 'La meta necesita un nombre')
  invariant(goal.target > 0, 'El objetivo de la meta debe ser mayor que cero')
}

/**
 * What is reserved for one goal on `asOf`. The reserve is followed day by day and can never go
 * below zero: releasing more than there was leaves it empty, and a later reservation starts again
 * from zero instead of paying for the excess.
 *
 * Within one day, what was reserved counts before what was released, whatever the identifiers
 * are: reserving and releasing on the same day always gives the same result.
 */
export function reservedForGoal(
  goalId: GoalId,
  reservations: readonly GoalReservation[],
  asOf: LocalDate,
): Money {
  const releasesLast = (reservation: GoalReservation): number => (reservation.amount < 0 ? 1 : 0)
  const relevant = reservations
    .filter((reservation) => !reservation.voided && reservation.goalId === goalId && reservation.date <= asOf)
    .toSorted(
      (a, b) => compareDates(a.date, b.date) || releasesLast(a) - releasesLast(b) || compareIds(a.id, b.id),
    )
  let total = ZERO
  for (const reservation of relevant) {
    total = atLeastZero(add(total, reservation.amount))
  }
  return total
}

function transferredToGoal(
  goalId: GoalId,
  transactions: readonly Transaction[],
  accounts: AccountIndex,
  asOf: LocalDate,
): Money {
  let total = ZERO
  for (const transaction of transactions) {
    if (
      transaction.voided ||
      transaction.kind !== 'transfer' ||
      transaction.goalId !== goalId ||
      transaction.date > asOf
    ) {
      continue
    }
    const fromSavings = accountClass(requireAccount(accounts, transaction.fromAccountId).kind) === 'savings'
    const toSavings = accountClass(requireAccount(accounts, transaction.toAccountId).kind) === 'savings'
    if (toSavings && !fromSavings) {
      total = add(total, transaction.amount)
    } else if (fromSavings && !toSavings) {
      total = subtract(total, transaction.amount)
    }
  }
  return atLeastZero(total)
}

export function goalProgress(
  goal: Goal,
  reservations: readonly GoalReservation[],
  transactions: readonly Transaction[],
  accounts: AccountIndex,
  asOf: LocalDate,
): GoalProgress {
  validateGoal(goal)
  const reserved = reservedForGoal(goal.id, reservations, asOf)
  const transferred = transferredToGoal(goal.id, transactions, accounts, asOf)
  const accumulated = add(reserved, transferred)
  const reached = accumulated >= goal.target
  return {
    goalId: goal.id,
    reserved,
    transferred,
    accumulated,
    remaining: atLeastZero(subtract(goal.target, accumulated)),
    percent: reached ? 100 : Number((BigInt(accumulated) * 100n) / BigInt(goal.target)),
    reached,
  }
}

/**
 * How much to put in each month to arrive on time, rounded up to the peso. `null` when the goal
 * has no date. When the date has already passed, the whole remainder.
 */
export function suggestedMonthlyContribution(goal: Goal, accumulated: Money, today: LocalDate): Money | null {
  if (goal.targetDate === undefined) {
    return null
  }
  const remaining = atLeastZero(subtract(goal.target, accumulated))
  if (remaining === 0 || goal.targetDate <= today) {
    return remaining
  }
  const from = yearMonthParts(yearMonthOf(today))
  const to = yearMonthParts(yearMonthOf(goal.targetDate))
  const monthsLeft = Math.max(1, (to.year - from.year) * 12 + (to.month - from.month))
  // Ceiling division with integers: ceil(a / b) = -floor(-a / b).
  return negate(mulDivFloor(negate(remaining), 1, monthsLeft))
}

/** True when `amount` can be released from the goal without leaving its reserve negative. */
export function canRelease(
  goalId: GoalId,
  amount: Money,
  reservations: readonly GoalReservation[],
  asOf: LocalDate,
): boolean {
  return amount > 0 && amount <= reservedForGoal(goalId, reservations, asOf)
}

export interface FulfilReservationInput {
  readonly goalId: GoalId
  readonly amount: Money
  /** The day the money is really moved. */
  readonly date: LocalDate
  readonly reservationId: ReservationId
  readonly transactionId: TransactionId
  readonly fromAccountId: AccountId
  /** A savings account. */
  readonly toAccountId: AccountId
  readonly reservations: readonly GoalReservation[]
  readonly accounts: AccountIndex
  readonly today: LocalDate
}

/**
 * Turns reserved money into an effective transfer to a savings account, in one step: the reserve
 * is released and the transfer is created together. Doing only the transfer would count the same
 * saving twice, once as reserved and once as transferred.
 */
export function fulfilReservation(input: FulfilReservationInput): {
  readonly release: GoalReservation
  readonly transfer: Transfer
} {
  invariant(
    canRelease(input.goalId, input.amount, input.reservations, input.date),
    'No hay tanto dinero reservado para esta meta',
  )
  const transfer: Transfer = {
    kind: 'transfer',
    id: input.transactionId,
    date: input.date,
    amount: input.amount,
    fromAccountId: input.fromAccountId,
    toAccountId: input.toAccountId,
    goalId: input.goalId,
    voided: false,
  }
  validateTransaction(transfer, { accounts: input.accounts, today: input.today })
  invariant(
    accountClass(requireAccount(input.accounts, input.toAccountId).kind) === 'savings',
    'La transferencia efectiva a una meta va a una cuenta de ahorro',
  )
  return {
    release: {
      id: input.reservationId,
      goalId: input.goalId,
      date: input.date,
      amount: negate(input.amount),
      voided: false,
    },
    transfer,
  }
}
