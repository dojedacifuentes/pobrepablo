import { type LocalDate, compareDates } from './dates'
import { invariant } from './errors'
import { type CategoryId, type MemberId, type SettlementId, type SharedExpenseId, compareIds } from './ids'
import { type Money, ZERO, add, minMoney, negate, subtract } from './money'
import type { HouseholdShareEntry } from './reports'
import { type Allocation, type Share, allocate } from './split'

/**
 * A common expense of the household.
 *
 * It keeps apart what must not be confused: the original expense (`total`), who really paid
 * (`payerId`), who takes part and in what proportion (`shares`). What each one owes, the
 * reimbursements and the state of each debt are derived from here, never stored.
 */
export interface SharedExpense {
  readonly id: SharedExpenseId
  readonly date: LocalDate
  readonly description: string
  readonly categoryId: CategoryId
  readonly total: Money
  readonly payerId: MemberId
  readonly shares: readonly Share<MemberId>[]
  readonly authorId: MemberId
  readonly voided: boolean
}

/** A reimbursement: `fromMemberId` gave money to `toMemberId` to pay back what was owed. */
export interface Settlement {
  readonly id: SettlementId
  readonly date: LocalDate
  readonly fromMemberId: MemberId
  readonly toMemberId: MemberId
  readonly amount: Money
  readonly authorId: MemberId
  readonly voided: boolean
}

export function validateSharedExpense(expense: SharedExpense, members: readonly MemberId[]): void {
  const known = new Set<string>(members)
  invariant(expense.total > 0, 'El gasto compartido debe ser mayor que cero')
  invariant(known.has(expense.payerId), `Quien pagó no es miembro del hogar: ${expense.payerId}`)
  for (const share of expense.shares) {
    invariant(known.has(share.participantId), `Participante que no es miembro del hogar: ${share.participantId}`)
  }
  // `allocate` rejects empty, repeated or zero-weight distributions.
  allocate(expense.total, expense.shares)
}

export function validateSettlement(settlement: Settlement, members: readonly MemberId[]): void {
  const known = new Set<string>(members)
  invariant(settlement.amount > 0, 'El reembolso debe ser mayor que cero')
  invariant(settlement.fromMemberId !== settlement.toMemberId, 'Un reembolso necesita dos personas distintas')
  invariant(
    known.has(settlement.fromMemberId) && known.has(settlement.toMemberId),
    'El reembolso nombra a alguien que no es miembro del hogar',
  )
}

/** What each participant must bear of the expense. The parts add up to exactly the total. */
export function expenseShares(expense: SharedExpense): Allocation<MemberId>[] {
  return allocate(expense.total, expense.shares)
}

function counts(entry: { readonly voided: boolean; readonly date: LocalDate }, asOf?: LocalDate): boolean {
  return !entry.voided && (asOf === undefined || entry.date <= asOf)
}

/**
 * The internal balance of each member: positive when the household owes them, negative when they
 * owe. Always recomputed from the events, and the balances always add up to zero.
 */
export function householdBalances(
  members: readonly MemberId[],
  expenses: readonly SharedExpense[],
  settlements: readonly Settlement[],
  asOf?: LocalDate,
): ReadonlyMap<MemberId, Money> {
  const balances = new Map<MemberId, Money>()
  for (const member of members) {
    invariant(!balances.has(member), `Miembro repetido: ${member}`)
    balances.set(member, ZERO)
  }
  const shift = (member: MemberId, delta: Money): void => {
    const current = balances.get(member)
    invariant(current !== undefined, `No es miembro del hogar: ${member}`)
    balances.set(member, add(current, delta))
  }

  for (const expense of expenses) {
    if (!counts(expense, asOf)) {
      continue
    }
    shift(expense.payerId, expense.total)
    for (const share of expenseShares(expense)) {
      shift(share.participantId, negate(share.amount))
    }
  }
  for (const settlement of settlements) {
    if (!counts(settlement, asOf)) {
      continue
    }
    shift(settlement.fromMemberId, settlement.amount)
    shift(settlement.toMemberId, negate(settlement.amount))
  }
  return balances
}

/** One member's own parts of the shared expenses: this is their expense in the reports. */
export function memberShares(
  memberId: MemberId,
  expenses: readonly SharedExpense[],
  asOf?: LocalDate,
): HouseholdShareEntry[] {
  const entries: HouseholdShareEntry[] = []
  for (const expense of expenses) {
    if (!counts(expense, asOf)) {
      continue
    }
    for (const share of expenseShares(expense)) {
      if (share.participantId === memberId && share.amount !== 0) {
        entries.push({
          sharedExpenseId: expense.id,
          date: expense.date,
          categoryId: expense.categoryId,
          amount: share.amount,
        })
      }
    }
  }
  return entries
}

export type ReconciliationStatus = 'pending' | 'partial' | 'settled'

/** What one member owes another because of one shared expense, and how much of it is paid back. */
export interface InternalObligation {
  readonly sharedExpenseId: SharedExpenseId
  readonly date: LocalDate
  readonly debtorId: MemberId
  readonly creditorId: MemberId
  readonly amount: Money
  readonly settled: Money
  readonly status: ReconciliationStatus
}

type OpenObligation = Omit<InternalObligation, 'settled' | 'status'>

/** Everything between two members. `net` is what `first` owes `second` once all is offset. */
interface PairLedger {
  readonly first: MemberId
  readonly second: MemberId
  readonly firstOwes: OpenObligation[]
  readonly secondOwes: OpenObligation[]
  net: Money
}

function pairLedgers(
  expenses: readonly SharedExpense[],
  settlements: readonly Settlement[],
  asOf?: LocalDate,
): PairLedger[] {
  const pairs = new Map<string, PairLedger>()
  const pairOf = (a: MemberId, b: MemberId): PairLedger => {
    const first = a < b ? a : b
    const second = a < b ? b : a
    const key = `${first}\u0000${second}`
    let pair = pairs.get(key)
    if (pair === undefined) {
      pair = { first, second, firstOwes: [], secondOwes: [], net: ZERO }
      pairs.set(key, pair)
    }
    return pair
  }

  for (const expense of expenses) {
    if (!counts(expense, asOf)) {
      continue
    }
    for (const share of expenseShares(expense)) {
      if (share.participantId === expense.payerId || share.amount <= 0) {
        continue
      }
      const pair = pairOf(share.participantId, expense.payerId)
      const obligation: OpenObligation = {
        sharedExpenseId: expense.id,
        date: expense.date,
        debtorId: share.participantId,
        creditorId: expense.payerId,
        amount: share.amount,
      }
      if (share.participantId === pair.first) {
        pair.firstOwes.push(obligation)
        pair.net = add(pair.net, share.amount)
      } else {
        pair.secondOwes.push(obligation)
        pair.net = subtract(pair.net, share.amount)
      }
    }
  }
  for (const settlement of settlements) {
    if (!counts(settlement, asOf)) {
      continue
    }
    const pair = pairOf(settlement.fromMemberId, settlement.toMemberId)
    pair.net =
      settlement.fromMemberId === pair.first
        ? subtract(pair.net, settlement.amount)
        : add(pair.net, settlement.amount)
  }

  return [...pairs.values()].sort((a, b) => compareIds(a.first, b.first) || compareIds(a.second, b.second))
}

export interface SuggestedSettlement {
  readonly fromMemberId: MemberId
  readonly toMemberId: MemberId
  readonly amount: Money
}

/**
 * The payments that settle everything: for every pair of members, whoever owes on balance pays
 * the other. With two people it is a single payment.
 *
 * Debts are deliberately not «simplified» across pairs: each payment answers to debts between
 * those two people, so paying what is suggested leaves every debt settled in `reconcile` too.
 */
export function suggestSettlements(
  expenses: readonly SharedExpense[],
  settlements: readonly Settlement[],
  asOf?: LocalDate,
): SuggestedSettlement[] {
  const suggestions: SuggestedSettlement[] = []
  for (const pair of pairLedgers(expenses, settlements, asOf)) {
    if (pair.net > 0) {
      suggestions.push({ fromMemberId: pair.first, toMemberId: pair.second, amount: pair.net })
    } else if (pair.net < 0) {
      suggestions.push({ fromMemberId: pair.second, toMemberId: pair.first, amount: negate(pair.net) })
    }
  }
  return suggestions
}

function clamp(value: Money, low: Money, high: Money): Money {
  return value < low ? low : value > high ? high : value
}

function totalOf(obligations: readonly OpenObligation[]): Money {
  return obligations.reduce((total, obligation) => add(total, obligation.amount), ZERO)
}

function settleOldestFirst(obligations: readonly OpenObligation[], settledTotal: Money): InternalObligation[] {
  let remaining = settledTotal
  return obligations
    .toSorted((a, b) => compareDates(a.date, b.date) || compareIds(a.sharedExpenseId, b.sharedExpenseId))
    .map((obligation): InternalObligation => {
      const settled = minMoney(obligation.amount, remaining)
      remaining = subtract(remaining, settled)
      const status: ReconciliationStatus =
        settled === obligation.amount ? 'settled' : settled === 0 ? 'pending' : 'partial'
      return { ...obligation, settled, status }
    })
}

/**
 * The reconciliation state of every internal debt.
 *
 * For each pair of members, what one owes is offset against what the other owes and against the
 * reimbursements between them; whatever was covered is applied to the oldest debts first.
 */
export function reconcile(
  expenses: readonly SharedExpense[],
  settlements: readonly Settlement[],
  asOf?: LocalDate,
): InternalObligation[] {
  const result: InternalObligation[] = []
  for (const pair of pairLedgers(expenses, settlements, asOf)) {
    const firstTotal = totalOf(pair.firstOwes)
    const secondTotal = totalOf(pair.secondOwes)
    const firstOutstanding = clamp(pair.net, ZERO, firstTotal)
    const secondOutstanding = clamp(negate(pair.net), ZERO, secondTotal)
    result.push(
      ...settleOldestFirst(pair.firstOwes, subtract(firstTotal, firstOutstanding)),
      ...settleOldestFirst(pair.secondOwes, subtract(secondTotal, secondOutstanding)),
    )
  }
  return result.sort(
    (a, b) =>
      compareDates(a.date, b.date) ||
      compareIds(a.sharedExpenseId, b.sharedExpenseId) ||
      compareIds(a.debtorId, b.debtorId),
  )
}
