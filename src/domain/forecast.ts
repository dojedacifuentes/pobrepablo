import type { LocalDate } from './dates'
import { type LedgerState, type SnapshotInput, ledgerState } from './magnitudes'
import {
  type Projection,
  type ScenarioAssumptions,
  type ScenarioName,
  type VariableSpendHistory,
  SCENARIOS,
  collectCashFlows,
  historyMonths,
  projectCashFlow,
  summarizeVariableSpend,
  variableSpendByMonth,
} from './projection'

/**
 * The day the person really started registering: their first movement or their first part of a
 * shared expense. An account opened months before the first movement is not history: those
 * months are empty because nothing was being written down, not because nothing was spent.
 */
export function firstActivityDate(input: SnapshotInput, state: LedgerState): LocalDate | null {
  let first: LocalDate | null = null
  const consider = (date: LocalDate): void => {
    if (date <= input.today && (first === null || date < first)) {
      first = date
    }
  }
  for (const transaction of input.transactions) {
    if (!transaction.voided) {
      consider(transaction.date)
    }
  }
  for (const share of state.householdShares) {
    consider(share.date)
  }
  return first
}

/** Shared expenses that are a recurring rule in disguise: the rule projects them, not the history. */
function recurringSharedExpenses(input: SnapshotInput): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const coverage of input.sharedCoverage ?? []) {
    ids.add(coverage.sharedExpenseId)
  }
  for (const transaction of input.transactions) {
    if (!transaction.voided && transaction.kind === 'shared_payment' && transaction.occurrence !== undefined) {
      ids.add(transaction.sharedExpenseId)
    }
  }
  return ids
}

function historyFrom(input: SnapshotInput, state: LedgerState): VariableSpendHistory {
  const months = historyMonths(firstActivityDate(input, state), input.today)
  return summarizeVariableSpend(
    variableSpendByMonth(
      input.transactions,
      state.householdShares,
      months,
      state.accountIndex,
      recurringSharedExpenses(input),
    ),
  )
}

/** The person's own history of everyday spending, from the complete months registered so far. */
export function variableSpendHistory(input: SnapshotInput): VariableSpendHistory {
  return historyFrom(input, ledgerState(input, input.today))
}

/**
 * Magnitude 8 from the stored facts: the projected cash flow from today to `end` under one
 * scenario. It recomputes what is pending up to the end of the horizon, gathers every known flow
 * and adds the estimate of everyday spending when there is enough history.
 *
 * It never changes anything: the simulator calls it with a modified copy of the input.
 */
export function projectFinances(input: SnapshotInput, end: LocalDate, scenario: ScenarioAssumptions): Projection {
  const state = ledgerState(input, end)
  return projectCashFlow({
    today: input.today,
    end,
    liquidBalance: state.liquidBalance,
    flows: collectCashFlows({
      occurrences: state.occurrences,
      obligations: state.obligations,
      accounts: state.accountIndex,
    }),
    history: historyFrom(input, state),
    scenario,
    cards: input.accounts.filter((account) => account.kind === 'credit_card'),
  })
}

/** The three scenarios side by side, for the same horizon. */
export function projectScenarios(input: SnapshotInput, end: LocalDate): Record<ScenarioName, Projection> {
  return {
    conservative: projectFinances(input, end, SCENARIOS.conservative),
    central: projectFinances(input, end, SCENARIOS.central),
    optimistic: projectFinances(input, end, SCENARIOS.optimistic),
  }
}
