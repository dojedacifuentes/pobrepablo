import { type LocalDate, type YearMonth, dayOfMonth, daysInYearMonth, yearMonthOf } from './dates'
import { invariant } from './errors'
import type { CategoryId } from './ids'
import { type Money, ZERO, atLeastZero, mulDivFloor, subtract } from './money'

/** What the person plans to spend on one category in one month. */
export interface Budget {
  readonly categoryId: CategoryId
  readonly month: YearMonth
  readonly planned: Money
  /**
   * A funded budget sets its unspent money apart: it is reserved and stops counting as available
   * to spend. A budget that is not funded is only a reference.
   */
  readonly funded: boolean
}

export type BudgetState = 'ok' | 'near' | 'exceeded'
export type BudgetTrend = 'under' | 'on_track' | 'over'

export interface BudgetStatus {
  readonly categoryId: CategoryId
  readonly month: YearMonth
  readonly planned: Money
  readonly spent: Money
  /** Planned minus spent. Negative when the budget was exceeded. */
  readonly available: Money
  /** Whole percentage of the plan already used; `null` when nothing was planned. */
  readonly percentUsed: number | null
  readonly state: BudgetState
  /** Spending pace against a steady, day-by-day use of the plan. */
  readonly trend: BudgetTrend
  /** Money this budget keeps apart today. Zero unless the budget is funded. */
  readonly reserved: Money
}

export const NEAR_LIMIT_PERCENT = 90
const PACE_TOLERANCE_PERCENT = 10

export function validateBudget(budget: Budget): void {
  invariant(budget.planned >= 0, 'El monto planificado no puede ser negativo')
}

function trendOf(budget: Budget, spent: Money, today: LocalDate): BudgetTrend {
  const currentMonth = yearMonthOf(today)
  const days = daysInYearMonth(budget.month)
  const elapsed = currentMonth > budget.month ? days : currentMonth < budget.month ? 0 : dayOfMonth(today)
  const expected = mulDivFloor(budget.planned, elapsed, days)
  const lower = mulDivFloor(expected, 100 - PACE_TOLERANCE_PERCENT, 100)
  const upper = mulDivFloor(expected, 100 + PACE_TOLERANCE_PERCENT, 100)
  if (spent > upper) {
    return 'over'
  }
  return spent < lower ? 'under' : 'on_track'
}

/**
 * The state of one budget.
 *
 * `pendingInCategory` is what is still owed this period in the same category (a rent that has not
 * been paid yet). A funded budget does not reserve that part again: it is already an obligation.
 */
export function budgetStatus(
  budget: Budget,
  spent: Money,
  pendingInCategory: Money,
  today: LocalDate,
): BudgetStatus {
  validateBudget(budget)
  const available = subtract(budget.planned, spent)
  const percentUsed =
    budget.planned > 0 ? Number((BigInt(atLeastZero(spent)) * 100n) / BigInt(budget.planned)) : null

  let state: BudgetState = 'ok'
  if (spent > budget.planned) {
    state = 'exceeded'
  } else if (percentUsed !== null && percentUsed >= NEAR_LIMIT_PERCENT) {
    state = 'near'
  }

  return {
    categoryId: budget.categoryId,
    month: budget.month,
    planned: budget.planned,
    spent,
    available,
    percentUsed,
    state,
    trend: trendOf(budget, spent, today),
    reserved: budget.funded ? atLeastZero(subtract(available, atLeastZero(pendingInCategory))) : ZERO,
  }
}

/** The state of every budget of `month`, in a stable order. */
export function budgetStatuses(
  budgets: readonly Budget[],
  month: YearMonth,
  spentByCategory: ReadonlyMap<CategoryId, Money>,
  pendingByCategory: ReadonlyMap<CategoryId, Money>,
  today: LocalDate,
): BudgetStatus[] {
  const seen = new Set<CategoryId>()
  const statuses: BudgetStatus[] = []
  for (const budget of budgets) {
    if (budget.month !== month) {
      continue
    }
    invariant(!seen.has(budget.categoryId), `Presupuesto repetido para la categoría ${budget.categoryId}`)
    seen.add(budget.categoryId)
    statuses.push(
      budgetStatus(
        budget,
        spentByCategory.get(budget.categoryId) ?? ZERO,
        pendingByCategory.get(budget.categoryId) ?? ZERO,
        today,
      ),
    )
  }
  return statuses.sort((a, b) => (a.categoryId < b.categoryId ? -1 : a.categoryId > b.categoryId ? 1 : 0))
}
