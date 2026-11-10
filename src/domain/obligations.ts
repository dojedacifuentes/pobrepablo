import { type AccountIndex, accountClass, requireAccount } from './accounts'
import { type CardStatement, cardDueDate, cardObligationHorizon } from './credit-card'
import { type LocalDate, type Period, compareDates, isWithin } from './dates'
import { type CategoryId, compareIds } from './ids'
import { type Money, ZERO, add, negate } from './money'
import { type Occurrence, isAwaiting } from './recurring'

/** `confirmed`: a known amount. `estimated`: a guess (a bill whose amount changes every time). */
export type Certainty = 'confirmed' | 'estimated'

/** Money that must leave a spendable account and has not left yet. */
export interface Obligation {
  readonly source: 'scheduled' | 'card' | 'household'
  /** Stable reference to where it comes from (a rule occurrence, a card instalment, the household). */
  readonly ref: string
  /** The rule's label, or the card's name. Empty for the household debt. */
  readonly label: string
  /** The day the money leaves a spendable account. */
  readonly dueDate: LocalDate
  readonly amount: Money
  readonly certainty: Certainty
  readonly categoryId?: CategoryId
}

export interface ObligationsInput {
  readonly occurrences: readonly Occurrence[]
  readonly accounts: AccountIndex
  readonly cardStatements: readonly CardStatement[]
  /** The member's internal household balance: negative when they owe. */
  readonly householdBalance: Money
  readonly today: LocalDate
  /** Last day of the period that is being looked at. */
  readonly through: LocalDate
}

/**
 * Magnitude 3: the pending obligations of the period.
 *
 * 1. Programmed expenses that are still waiting (pending, estimated or overdue). Paid from a
 *    spendable account, they count when they fall due on or before the end of the period.
 *    Charged to a credit card, they count when the bill that will include them is inside the
 *    card's horizon. Paid from a savings account, they never touch spendable balance.
 * 2. Credit-card instalments still unpaid inside the card's horizon: the end of the period or the
 *    bill that would include a purchase made today, whichever is later. So whatever was bought
 *    with the card up to today already counts, exactly as if it had been paid by debit.
 * 3. What the member owes the household.
 *
 * Programmed transfers are not obligations: they move money between own accounts. A card payment
 * is already represented by the card's instalments, so it is never counted twice.
 */
export function pendingObligations(input: ObligationsInput): Obligation[] {
  const obligations: Obligation[] = []

  for (const occurrence of input.occurrences) {
    if (occurrence.kind !== 'expense' || !isAwaiting(occurrence)) {
      continue
    }
    const account = requireAccount(input.accounts, occurrence.accountId)
    let cashDate: LocalDate
    let limit: LocalDate
    switch (accountClass(account.kind)) {
      case 'liquid':
        cashDate = occurrence.dueDate
        limit = input.through
        break
      case 'liability':
        cashDate = cardDueDate(account, occurrence.dueDate)
        limit = cardObligationHorizon(account, input.today, input.through)
        break
      case 'savings':
        continue
    }
    if (cashDate > limit) {
      continue
    }
    obligations.push({
      source: 'scheduled',
      ref: `${occurrence.ruleId}@${occurrence.dueDate}`,
      label: occurrence.label,
      dueDate: cashDate,
      amount: occurrence.amount,
      certainty: occurrence.amountIsEstimate ? 'estimated' : 'confirmed',
      ...(occurrence.categoryId !== undefined ? { categoryId: occurrence.categoryId } : {}),
    })
  }

  for (const statement of input.cardStatements) {
    const card = requireAccount(input.accounts, statement.accountId)
    const horizon = cardObligationHorizon(card, input.today, input.through)
    for (const installment of statement.installments) {
      if (installment.outstanding <= 0 || installment.dueDate > horizon) {
        continue
      }
      obligations.push({
        source: 'card',
        ref: `${statement.accountId}:${installment.sourceId}:${String(installment.number)}`,
        label: card.name,
        dueDate: installment.dueDate,
        amount: installment.outstanding,
        certainty: 'confirmed',
      })
    }
  }

  if (input.householdBalance < 0) {
    obligations.push({
      source: 'household',
      ref: 'household',
      label: '',
      dueDate: input.today,
      amount: negate(input.householdBalance),
      certainty: 'confirmed',
    })
  }

  return obligations.sort(
    (a, b) => compareDates(a.dueDate, b.dueDate) || compareIds(a.source, b.source) || compareIds(a.ref, b.ref),
  )
}

export function totalObligations(obligations: readonly Obligation[]): Money {
  let total = ZERO
  for (const obligation of obligations) {
    total = add(total, obligation.amount)
  }
  return total
}

/**
 * Programmed expenses of each category that fall inside `period` and are still waiting, whatever
 * account they will be paid from. A funded budget does not reserve this part again: when the
 * expense is confirmed it will use the budget, so reserving it too would count it twice.
 * Expenses left over from earlier months belong to those months' budgets, not to this one.
 */
export function awaitingExpensesByCategory(
  occurrences: readonly Occurrence[],
  period: Period,
): ReadonlyMap<CategoryId, Money> {
  const byCategory = new Map<CategoryId, Money>()
  for (const occurrence of occurrences) {
    if (
      occurrence.kind === 'expense' &&
      occurrence.categoryId !== undefined &&
      isAwaiting(occurrence) &&
      isWithin(occurrence.dueDate, period)
    ) {
      byCategory.set(occurrence.categoryId, add(byCategory.get(occurrence.categoryId) ?? ZERO, occurrence.amount))
    }
  }
  return byCategory
}
