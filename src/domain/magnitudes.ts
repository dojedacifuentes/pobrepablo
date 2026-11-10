import { type Account, type AccountIndex, indexAccounts } from './accounts'
import {
  type Balances,
  accountBalance,
  balanceByClass,
  balancesFromHistory,
  liquidBalance,
  totalRegisteredBalance,
} from './balances'
import { type Budget, type BudgetStatus, budgetStatuses } from './budgets'
import { type CardStatement, cardStatement } from './credit-card'
import { type LocalDate, type Period, monthPeriod, yearMonthOf } from './dates'
import { invariant } from './errors'
import { type Goal, type GoalProgress, type GoalReservation, goalProgress } from './goals'
import { type Settlement, type SharedExpense, householdBalances, memberShares } from './household'
import type { MemberId } from './ids'
import { type Money, ZERO, add, atLeastZero, negate, subtract } from './money'
import { type Obligation, awaitingExpensesByCategory, pendingObligations, totalObligations } from './obligations'
import { type Occurrence, type OccurrenceCoverage, type RecurringRule, listOccurrences } from './recurring'
import { type HouseholdShareEntry, type PeriodTotals, periodTotals } from './reports'
import type { OccurrenceRef, Transaction } from './transactions'

/** The household as seen from one member's phone. */
export interface HouseholdView {
  readonly memberId: MemberId
  readonly members: readonly MemberId[]
  readonly expenses: readonly SharedExpense[]
  readonly settlements: readonly Settlement[]
}

/** Money set apart: for a savings goal, or by a funded budget. */
export interface Reserve {
  readonly kind: 'goal' | 'budget'
  readonly ref: string
  readonly amount: Money
}

export type ExplanationCode = 'liquid_balance' | 'pending_obligations' | 'reserved' | 'available_to_spend'

/** One line of «¿cómo se calcula?». The amounts of the first three lines add up to the last one. */
export interface ExplanationStep {
  readonly code: ExplanationCode
  readonly amount: Money
}

export interface AvailableToSpend {
  readonly liquidBalance: Money
  readonly obligations: Money
  readonly reserved: Money
  /** Can be negative: the confirmed balance does not cover what is owed and set apart. */
  readonly available: Money
  readonly steps: readonly ExplanationStep[]
}

export interface NetWorth {
  readonly assets: Money
  readonly liabilities: Money
  readonly net: Money
}

/**
 * Magnitude 5: available to spend = confirmed liquid balance − pending obligations of the
 * period − reserves. The steps explain it line by line.
 */
export function availableToSpend(liquid: Money, obligations: Money, reserved: Money): AvailableToSpend {
  const available = subtract(subtract(liquid, obligations), reserved)
  return {
    liquidBalance: liquid,
    obligations,
    reserved,
    available,
    steps: [
      { code: 'liquid_balance', amount: liquid },
      { code: 'pending_obligations', amount: negate(obligations) },
      { code: 'reserved', amount: negate(reserved) },
      { code: 'available_to_spend', amount: available },
    ],
  }
}

/** Magnitude 4: reserved money, itemised. Goal reserves first, then funded budgets. */
export function reservedMoney(goals: readonly GoalProgress[], budgets: readonly BudgetStatus[]): Reserve[] {
  const reserves: Reserve[] = []
  for (const goal of goals) {
    if (goal.reserved > 0) {
      reserves.push({ kind: 'goal', ref: goal.goalId, amount: goal.reserved })
    }
  }
  for (const budget of budgets) {
    if (budget.reserved > 0) {
      reserves.push({ kind: 'budget', ref: budget.categoryId, amount: budget.reserved })
    }
  }
  return reserves
}

export function totalReserved(reserves: readonly Reserve[]): Money {
  let total = ZERO
  for (const reserve of reserves) {
    total = add(total, reserve.amount)
  }
  return total
}

/**
 * Magnitude 6: net worth = assets − liabilities. Assets are positive account balances and what
 * the household owes the member; liabilities are card debts, overdrawn accounts and what the
 * member owes the household.
 */
export function netWorth(accounts: readonly Account[], balances: Balances, householdBalance: Money): NetWorth {
  let assets = atLeastZero(householdBalance)
  let liabilities = atLeastZero(negate(householdBalance))
  for (const account of accounts) {
    const balance = accountBalance(balances, account.id)
    assets = add(assets, atLeastZero(balance))
    liabilities = add(liabilities, atLeastZero(negate(balance)))
  }
  return { assets, liabilities, net: subtract(assets, liabilities) }
}

/** Magnitude 7: accumulated savings = savings accounts + money reserved for goals. */
export function accumulatedSavings(accounts: readonly Account[], balances: Balances, goalReserves: Money): Money {
  return add(balanceByClass(accounts, balances, 'savings'), goalReserves)
}

/** Everything stored about one person's finances, plus the day it is being looked at. */
export interface SnapshotInput {
  readonly accounts: readonly Account[]
  readonly transactions: readonly Transaction[]
  readonly rules: readonly RecurringRule[]
  readonly cancelledOccurrences: readonly OccurrenceRef[]
  /** Programmed expenses that a shared expense paid by another member already took care of. */
  readonly sharedCoverage?: readonly OccurrenceCoverage[]
  readonly budgets: readonly Budget[]
  readonly goals: readonly Goal[]
  readonly reservations: readonly GoalReservation[]
  readonly household?: HouseholdView
  readonly today: LocalDate
}

/** What is confirmed today and what is still owed up to a given day. */
export interface LedgerState {
  readonly accountIndex: AccountIndex
  /** Magnitude 1. */
  readonly balances: Balances
  readonly liquidBalance: Money
  readonly occurrences: readonly Occurrence[]
  readonly cardStatements: readonly CardStatement[]
  /** The member's internal household balance: positive when owed, negative when owing. */
  readonly householdBalance: Money
  readonly householdShares: readonly HouseholdShareEntry[]
  /** Magnitude 3, up to the requested day. */
  readonly obligations: readonly Obligation[]
}

/**
 * The confirmed state as of today and everything pending up to `through`. The dashboard asks up
 * to the end of the month; the projection asks up to the end of its horizon.
 */
export function ledgerState(input: SnapshotInput, through: LocalDate): LedgerState {
  const { today } = input
  const accountIndex = indexAccounts(input.accounts)
  const balances = balancesFromHistory(input.accounts, input.transactions, today)

  const household = input.household
  let householdBalance = ZERO
  let householdShares: HouseholdShareEntry[] = []
  let liveShared = new Set<string>()
  if (household !== undefined) {
    const mine = householdBalances(household.members, household.expenses, household.settlements, today).get(
      household.memberId,
    )
    invariant(mine !== undefined, `No es miembro del hogar: ${household.memberId}`)
    householdBalance = mine
    householdShares = memberShares(household.memberId, household.expenses, today)
    liveShared = new Set(
      household.expenses.filter((expense) => !expense.voided && expense.date <= today).map((expense) => expense.id),
    )
  }

  const occurrences = listOccurrences({
    rules: input.rules,
    transactions: input.transactions,
    cancelled: input.cancelledOccurrences,
    // A coverage only holds while the shared expense behind it is alive.
    coveredByShared: (input.sharedCoverage ?? []).filter((coverage) => liveShared.has(coverage.sharedExpenseId)),
    accounts: accountIndex,
    today,
    through,
  })
  const cardStatements = input.accounts
    .filter((account) => account.kind === 'credit_card')
    .map((card) => cardStatement(card, input.transactions, today))

  const obligations = pendingObligations({
    occurrences,
    accounts: accountIndex,
    cardStatements,
    householdBalance,
    today,
    through,
  })

  return {
    accountIndex,
    balances,
    liquidBalance: liquidBalance(input.accounts, balances),
    occurrences,
    cardStatements,
    householdBalance,
    householdShares,
    obligations,
  }
}

/** Everything the dashboard shows, computed in one place from the stored facts. */
export interface FinancialSnapshot extends LedgerState {
  readonly today: LocalDate
  /** The current calendar month. */
  readonly period: Period
  /** Magnitude 2. */
  readonly totalBalance: Money
  /** Month to date. */
  readonly totals: PeriodTotals
  readonly obligationsTotal: Money
  readonly budgets: readonly BudgetStatus[]
  /** Goals that are not archived. */
  readonly goals: readonly GoalProgress[]
  /** Magnitude 4. */
  readonly reserves: readonly Reserve[]
  readonly reservedTotal: Money
  /** Magnitude 5. */
  readonly available: AvailableToSpend
  /** Magnitude 6. */
  readonly netWorth: NetWorth
  /** Magnitude 7. */
  readonly savings: Money
}

/**
 * Computes every magnitude as of `today`. Only movements dated on or before today count; the
 * period is the current calendar month.
 */
export function financialSnapshot(input: SnapshotInput): FinancialSnapshot {
  const { today } = input
  const month = yearMonthOf(today)
  const period = monthPeriod(month)
  const state = ledgerState(input, period.end)

  const totals = periodTotals(input.transactions, { start: period.start, end: today }, state.householdShares)
  const obligationsTotal = totalObligations(state.obligations)

  const budgets = budgetStatuses(
    input.budgets,
    month,
    totals.expenseByCategory,
    awaitingExpensesByCategory(state.occurrences, period),
    today,
  )
  // An archived goal no longer sets money apart: archiving it releases whatever it had reserved.
  const goals = input.goals
    .filter((goal) => !goal.archived)
    .map((goal) => goalProgress(goal, input.reservations, input.transactions, state.accountIndex, today))

  const reserves = reservedMoney(goals, budgets)
  const reservedTotal = totalReserved(reserves)
  const goalReserves = goals.reduce((total, goal) => add(total, goal.reserved), ZERO)

  return {
    ...state,
    today,
    period,
    totalBalance: totalRegisteredBalance(input.accounts, state.balances),
    totals,
    obligationsTotal,
    budgets,
    goals,
    reserves,
    reservedTotal,
    available: availableToSpend(state.liquidBalance, obligationsTotal, reservedTotal),
    netWorth: netWorth(input.accounts, state.balances, state.householdBalance),
    savings: accumulatedSavings(input.accounts, state.balances, goalReserves),
  }
}
