import type { LocalDate } from './dates'
import { type SnapshotInput, ledgerState } from './magnitudes'
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

/** The day the person started registering: the earliest opening date among their accounts. */
export function firstActivityDate(input: SnapshotInput): LocalDate | null {
  let first: LocalDate | null = null
  for (const account of input.accounts) {
    if (first === null || account.openingDate < first) {
      first = account.openingDate
    }
  }
  return first
}

/** The person's own history of everyday spending, from the complete months registered so far. */
export function variableSpendHistory(input: SnapshotInput): VariableSpendHistory {
  const state = ledgerState(input, input.today)
  const months = historyMonths(firstActivityDate(input), input.today)
  return summarizeVariableSpend(
    variableSpendByMonth(input.transactions, state.householdShares, months, state.accountIndex),
  )
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
  const months = historyMonths(firstActivityDate(input), input.today)
  const history = summarizeVariableSpend(
    variableSpendByMonth(input.transactions, state.householdShares, months, state.accountIndex),
  )
  return projectCashFlow({
    today: input.today,
    end,
    liquidBalance: state.liquidBalance,
    flows: collectCashFlows({
      occurrences: state.occurrences,
      obligations: state.obligations,
      accounts: state.accountIndex,
    }),
    history,
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
