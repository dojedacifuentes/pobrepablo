import { type LocalDate, type Period, isWithin } from './dates'
import type { CategoryId, SharedExpenseId } from './ids'
import { type Money, ZERO, add, subtract } from './money'
import type { Transaction } from './transactions'

/** A member's own part of a shared household expense. It is that member's expense. */
export interface HouseholdShareEntry {
  readonly sharedExpenseId: SharedExpenseId
  readonly date: LocalDate
  readonly categoryId: CategoryId
  readonly amount: Money
}

export interface PeriodTotals {
  readonly income: Money
  readonly expense: Money
  /** Income minus expense. */
  readonly net: Money
  readonly incomeByCategory: ReadonlyMap<CategoryId, Money>
  readonly expenseByCategory: ReadonlyMap<CategoryId, Money>
}

function accumulate(target: Map<CategoryId, Money>, categoryId: CategoryId, amount: Money): void {
  target.set(categoryId, add(target.get(categoryId) ?? ZERO, amount))
}

/**
 * Income and expense of a period.
 *
 * Counted as expense: purchases (also on a credit card, on the purchase date) and the member's own
 * share of shared expenses. Counted as income: net money received.
 *
 * Never counted: transfers (so paying the card or moving money to savings is not a second
 * expense), the cash paid on behalf of the household, reimbursements and balance adjustments.
 */
export function periodTotals(
  transactions: readonly Transaction[],
  period: Period,
  householdShares: readonly HouseholdShareEntry[] = [],
): PeriodTotals {
  const incomeByCategory = new Map<CategoryId, Money>()
  const expenseByCategory = new Map<CategoryId, Money>()
  let income = ZERO
  let expense = ZERO

  for (const transaction of transactions) {
    if (transaction.voided || !isWithin(transaction.date, period)) {
      continue
    }
    if (transaction.kind === 'income') {
      income = add(income, transaction.amount)
      accumulate(incomeByCategory, transaction.categoryId, transaction.amount)
    } else if (transaction.kind === 'expense') {
      expense = add(expense, transaction.amount)
      accumulate(expenseByCategory, transaction.categoryId, transaction.amount)
    }
  }

  for (const share of householdShares) {
    if (!isWithin(share.date, period)) {
      continue
    }
    expense = add(expense, share.amount)
    accumulate(expenseByCategory, share.categoryId, share.amount)
  }

  return { income, expense, net: subtract(income, expense), incomeByCategory, expenseByCategory }
}
