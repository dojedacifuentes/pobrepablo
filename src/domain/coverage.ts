import { type LocalDate, compareDates, yearMonthOf } from './dates'
import { type SharedExpense, expenseShares } from './household'
import { type MemberId, type SharedExpenseId, compareIds } from './ids'
import { type Occurrence, type OccurrenceCoverage, type RecurringRule, isAwaiting } from './recurring'

/**
 * Linking a programmed expense with the shared household expense that took care of it.
 *
 * When the other member pays the whole rent and shares it, the person who had «rent» programmed
 * must not owe it twice: once as the programmed expense and once as the debt with the household.
 * A coverage says «this shared expense is that programmed expense». It is only believed when it
 * makes sense; otherwise it is ignored and the programmed expense stays pending.
 */

function memberPart(expense: SharedExpense, memberId: MemberId): number {
  return expenseShares(expense).find((share) => share.participantId === memberId)?.amount ?? 0
}

/** A shared expense can cover a programmed expense of `memberId` only if somebody else paid it and the member bears a part. */
function canCover(expense: SharedExpense, memberId: MemberId, today: LocalDate): boolean {
  return !expense.voided && expense.date <= today && expense.payerId !== memberId && memberPart(expense, memberId) > 0
}

/**
 * The coverages that hold. A coverage is dropped when its rule is not an expense, when its shared
 * expense is missing, voided, dated after today, of another category, paid by the member themself
 * or does not include them, and when the occurrence or the shared expense was already used by an
 * earlier coverage.
 */
export function validCoverage(
  coverage: readonly OccurrenceCoverage[],
  rules: readonly RecurringRule[],
  memberId: MemberId,
  expenses: readonly SharedExpense[],
  today: LocalDate,
): OccurrenceCoverage[] {
  const expenseRules = new Map(rules.filter((rule) => rule.kind === 'expense').map((rule) => [rule.id, rule]))
  const byId = new Map(expenses.map((expense) => [expense.id, expense]))
  const usedOccurrences = new Set<string>()
  const usedExpenses = new Set<SharedExpenseId>()

  return coverage.filter((item) => {
    const occurrenceKey = `${item.ref.ruleId}\u0000${item.ref.dueDate}`
    const expense = byId.get(item.sharedExpenseId)
    const rule = expenseRules.get(item.ref.ruleId)
    const holds =
      rule !== undefined &&
      expense !== undefined &&
      // The same expense has the same category on both sides: a taxi cannot cover the rent.
      rule.categoryId === expense.categoryId &&
      canCover(expense, memberId, today) &&
      !usedOccurrences.has(occurrenceKey) &&
      !usedExpenses.has(item.sharedExpenseId)
    if (holds) {
      usedOccurrences.add(occurrenceKey)
      usedExpenses.add(item.sharedExpenseId)
    }
    return holds
  })
}

/**
 * Programmed expenses that are probably being counted twice: one is still waiting while a shared
 * expense of the same category and the same month, paid by somebody else, already charged the
 * member their part. The interface asks «is this the same expense?» and, on a yes, stores the
 * coverage.
 */
export function coverageCandidates(
  occurrences: readonly Occurrence[],
  memberId: MemberId,
  expenses: readonly SharedExpense[],
  coverage: readonly OccurrenceCoverage[],
  today: LocalDate,
): OccurrenceCoverage[] {
  const alreadyUsed = new Set(coverage.map((item) => item.sharedExpenseId))
  const candidates: OccurrenceCoverage[] = []
  for (const occurrence of occurrences) {
    if (occurrence.kind !== 'expense' || !isAwaiting(occurrence) || occurrence.categoryId === undefined) {
      continue
    }
    for (const expense of expenses) {
      if (
        !alreadyUsed.has(expense.id) &&
        canCover(expense, memberId, today) &&
        expense.categoryId === occurrence.categoryId &&
        yearMonthOf(expense.date) === yearMonthOf(occurrence.dueDate)
      ) {
        candidates.push({
          ref: { ruleId: occurrence.ruleId, dueDate: occurrence.dueDate },
          sharedExpenseId: expense.id,
        })
      }
    }
  }
  return candidates.sort(
    (a, b) =>
      compareDates(a.ref.dueDate, b.ref.dueDate) ||
      compareIds(a.ref.ruleId, b.ref.ruleId) ||
      compareIds(a.sharedExpenseId, b.sharedExpenseId),
  )
}
