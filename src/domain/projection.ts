import { type Account, type AccountIndex, accountClass, requireAccount } from './accounts'
import { cardDueDate } from './credit-card'
import {
  type LocalDate,
  type YearMonth,
  addDays,
  addMonths,
  compareDates,
  dayOfMonth,
  daysBetween,
  daysInYearMonth,
  isWithin,
  lastDayOf,
  monthPeriod,
  yearMonthOf,
} from './dates'
import { invariant } from './errors'
import type { AccountId } from './ids'
import { type Money, ZERO, add, money, mulDivFloor, negate, subtract } from './money'
import type { Certainty, Obligation } from './obligations'
import { type Occurrence, isAwaiting } from './recurring'
import type { HouseholdShareEntry } from './reports'
import type { Transaction } from './transactions'

/** Money expected to enter (positive) or leave (negative) spendable accounts on a day. */
export interface CashFlow {
  readonly date: LocalDate
  readonly amount: Money
  readonly certainty: Certainty
  readonly source: 'obligation' | 'income' | 'transfer'
  readonly label: string
}

export type ScenarioName = 'conservative' | 'central' | 'optimistic'

/** The assumptions of a scenario. They are data on purpose: the screen shows them as they are. */
export interface ScenarioAssumptions {
  readonly name: ScenarioName
  /** Whether income that is only expected or of variable amount is counted. */
  readonly includeEstimatedInflows: boolean
  /** Which figure of the person's own history stands for everyday variable spending. */
  readonly variableSpend: 'highest' | 'median' | 'lowest'
}

export const SCENARIOS: Readonly<Record<ScenarioName, ScenarioAssumptions>> = {
  conservative: { name: 'conservative', includeEstimatedInflows: false, variableSpend: 'highest' },
  central: { name: 'central', includeEstimatedInflows: true, variableSpend: 'median' },
  optimistic: { name: 'optimistic', includeEstimatedInflows: true, variableSpend: 'lowest' },
}

/** Fewer complete months than this and variable spending is not estimated at all. */
export const MIN_HISTORY_MONTHS = 3
export const MAX_HISTORY_MONTHS = 6

/**
 * Everyday (non-recurring) spending of one month, by how it was paid. The difference matters:
 * what is paid by debit or cash leaves the account that day; what is paid with a card leaves it
 * later, when the card's bill is paid.
 */
export interface VariableSpend {
  /** Paid from spendable accounts, plus the member's parts of shared expenses. */
  readonly liquid: Money
  readonly byCard: ReadonlyMap<AccountId, Money>
}

export interface VariableSpendHistory {
  readonly monthsAvailable: number
  /** False with fewer than three complete months: the projection then uses known commitments only. */
  readonly sufficient: boolean
  /** The cheapest month, split by way of paying. */
  readonly lowest: VariableSpend
  /** The median month: it resists one unusual month far better than the average. */
  readonly median: VariableSpend
  /** The most expensive month. */
  readonly highest: VariableSpend
}

const NO_SPEND: VariableSpend = { liquid: ZERO, byCard: new Map() }

function totalOf(spend: VariableSpend): Money {
  let total = spend.liquid
  for (const amount of spend.byCard.values()) {
    total = add(total, amount)
  }
  return total
}

/**
 * Summarises the history of everyday spending.
 *
 * The three figures are real monthly totals of the person: the cheapest month, the median and the
 * most expensive. Each total is then split by way of paying in the proportion of the whole
 * history, because how something is paid changes from month to month while how much is spent is
 * what the scenario is about. A larger total never gives less for any way of paying. The split
 * rounds down, so the parts can add up to a few pesos less than the total: it is an estimate.
 */
export function summarizeVariableSpend(months: readonly VariableSpend[]): VariableSpendHistory {
  if (months.length === 0) {
    return { monthsAvailable: 0, sufficient: false, lowest: NO_SPEND, median: NO_SPEND, highest: NO_SPEND }
  }

  const totals = months.map(totalOf).toSorted((a, b) => a - b)
  const lowest = totals[0] ?? ZERO
  const highest = totals[totals.length - 1] ?? ZERO
  const upperMiddle = totals[Math.floor(totals.length / 2)] ?? highest
  const lowerMiddle = totals[Math.floor((totals.length - 1) / 2)] ?? lowest
  const median = mulDivFloor(add(lowerMiddle, upperMiddle), 1, 2)

  let liquidWeight = ZERO
  const cardWeights = new Map<AccountId, Money>()
  for (const month of months) {
    liquidWeight = add(liquidWeight, month.liquid)
    for (const [cardId, amount] of month.byCard) {
      cardWeights.set(cardId, add(cardWeights.get(cardId) ?? ZERO, amount))
    }
  }
  const allWeight = totalOf({ liquid: liquidWeight, byCard: cardWeights })
  const cardIds = [...cardWeights.keys()].sort()

  const split = (total: Money): VariableSpend => {
    if (allWeight === 0) {
      return { liquid: ZERO, byCard: new Map(cardIds.map((cardId) => [cardId, ZERO])) }
    }
    return {
      liquid: mulDivFloor(total, liquidWeight, allWeight),
      byCard: new Map(
        cardIds.map((cardId) => [cardId, mulDivFloor(total, cardWeights.get(cardId) ?? ZERO, allWeight)]),
      ),
    }
  }

  return {
    monthsAvailable: months.length,
    sufficient: months.length >= MIN_HISTORY_MONTHS,
    lowest: split(lowest),
    median: split(median),
    highest: split(highest),
  }
}

/**
 * The complete months that can be trusted as history: after the month in which the person started
 * registering (usually a partial month) and before the current one. At most the last six.
 */
export function historyMonths(firstActivity: LocalDate | null, today: LocalDate): YearMonth[] {
  if (firstActivity === null) {
    return []
  }
  const current = yearMonthOf(today)
  const months: YearMonth[] = []
  let month = addMonths(yearMonthOf(firstActivity), 1)
  while (month < current) {
    months.push(month)
    month = addMonths(month, 1)
  }
  return months.slice(-MAX_HISTORY_MONTHS)
}

/**
 * Everyday spending of each month: expenses that did not come from a recurring rule, split by
 * how they were paid, plus the member's parts of shared expenses. Recurring expenses are
 * projected one by one, not estimated. Expenses paid from a savings account are left out: they
 * never touch spendable balance.
 */
export function variableSpendByMonth(
  transactions: readonly Transaction[],
  householdShares: readonly HouseholdShareEntry[],
  months: readonly YearMonth[],
  accounts: AccountIndex,
  /**
   * Shared expenses that belong to a recurring rule (the shared rent): they are projected one by
   * one through that rule, so their parts must stay out of everyday spending.
   */
  recurringSharedExpenses: ReadonlySet<string> = new Set(),
): VariableSpend[] {
  return months.map((month) => {
    const period = monthPeriod(month)
    let liquid = ZERO
    const byCard = new Map<AccountId, Money>()
    for (const transaction of transactions) {
      if (
        transaction.voided ||
        transaction.kind !== 'expense' ||
        transaction.occurrence !== undefined ||
        !isWithin(transaction.date, period)
      ) {
        continue
      }
      switch (accountClass(requireAccount(accounts, transaction.accountId).kind)) {
        case 'liquid':
          liquid = add(liquid, transaction.amount)
          break
        case 'liability':
          byCard.set(transaction.accountId, add(byCard.get(transaction.accountId) ?? ZERO, transaction.amount))
          break
        case 'savings':
          break
      }
    }
    for (const share of householdShares) {
      if (isWithin(share.date, period) && !recurringSharedExpenses.has(share.sharedExpenseId)) {
        liquid = add(liquid, share.amount)
      }
    }
    return { liquid, byCard }
  })
}

export interface CashFlowInput {
  /** Occurrences up to the end of the horizon. */
  readonly occurrences: readonly Occurrence[]
  /** Pending obligations up to the end of the horizon. */
  readonly obligations: readonly Obligation[]
  readonly accounts: AccountIndex
}

function isLiquid(accounts: AccountIndex, accountId: AccountId): boolean {
  return accountClass(requireAccount(accounts, accountId).kind) === 'liquid'
}

/**
 * Everything already known that will move spendable money.
 *
 * - Obligations leave.
 * - Programmed income arrives; one whose date already passed without being registered is only
 *   an estimate.
 * - A programmed transfer to savings leaves; one from savings arrives. Transfers to a credit card
 *   are skipped: the card's instalments are already obligations.
 */
export function collectCashFlows(input: CashFlowInput): CashFlow[] {
  const flows: CashFlow[] = input.obligations.map((obligation) => ({
    date: obligation.dueDate,
    amount: negate(obligation.amount),
    certainty: obligation.certainty,
    source: 'obligation',
    label: obligation.label,
  }))

  for (const occurrence of input.occurrences) {
    if (!isAwaiting(occurrence)) {
      continue
    }
    const uncertain = occurrence.amountIsEstimate || occurrence.status === 'overdue'
    if (occurrence.kind === 'income') {
      if (isLiquid(input.accounts, occurrence.accountId)) {
        flows.push({
          date: occurrence.dueDate,
          amount: occurrence.amount,
          certainty: uncertain ? 'estimated' : 'confirmed',
          source: 'income',
          label: occurrence.label,
        })
      }
    } else if (occurrence.kind === 'transfer' && occurrence.toAccountId !== undefined) {
      const fromClass = accountClass(requireAccount(input.accounts, occurrence.accountId).kind)
      const toClass = accountClass(requireAccount(input.accounts, occurrence.toAccountId).kind)
      if (fromClass === 'liability' || toClass === 'liability' || fromClass === toClass) {
        continue
      }
      flows.push({
        date: occurrence.dueDate,
        amount: fromClass === 'liquid' ? negate(occurrence.amount) : occurrence.amount,
        certainty: occurrence.amountIsEstimate ? 'estimated' : 'confirmed',
        source: 'transfer',
        label: occurrence.label,
      })
    }
  }

  return flows.sort((a, b) => compareDates(a.date, b.date))
}

export interface ProjectionInput {
  readonly today: LocalDate
  readonly end: LocalDate
  /** Confirmed liquid balance today. */
  readonly liquidBalance: Money
  readonly flows: readonly CashFlow[]
  readonly history: VariableSpendHistory
  readonly scenario: ScenarioAssumptions
  /** The credit cards, to know when everyday spending made with each one will be billed. */
  readonly cards?: readonly Account[]
}

export interface ProjectionPoint {
  readonly date: LocalDate
  /** Today's balance plus the commitments of known amount. */
  readonly confirmed: Money
  /** The confirmed line plus everything estimated under the scenario. */
  readonly projected: Money
}

/** The calculation, laid open: `endProjected` is exactly the sum of these lines. */
export interface ProjectionBreakdown {
  readonly startBalance: Money
  readonly confirmedIn: Money
  readonly confirmedOut: Money
  readonly estimatedIn: Money
  readonly estimatedOut: Money
  /** Estimated everyday spending that leaves spendable accounts inside the horizon. */
  readonly variableSpend: Money
}

export interface Projection {
  readonly scenario: ScenarioAssumptions
  readonly today: LocalDate
  readonly end: LocalDate
  /** One point per day, from today to the end of the horizon. */
  readonly points: readonly ProjectionPoint[]
  readonly endConfirmed: Money
  readonly endProjected: Money
  readonly lowestProjected: ProjectionPoint
  /** The first day on which the projected balance goes below zero, if any. */
  readonly firstNegativeDate: LocalDate | null
  /** False when there is not enough history: only known commitments were used. */
  readonly usesVariableEstimate: boolean
  /** The monthly figures used for everyday spending, or `null` when none was used. */
  readonly monthlyVariableEstimate: VariableSpend | null
  readonly breakdown: ProjectionBreakdown
}

/**
 * The part of a monthly estimate that falls on one day: an equal base every day, and the leftover
 * pesos on the first days of the month. The days of a month add up to exactly the month, and a
 * larger monthly figure never gives a smaller amount for any stretch of days.
 */
export function dailyShare(monthlyAmount: Money, date: LocalDate): Money {
  invariant(monthlyAmount >= 0, 'El gasto mensual estimado no puede ser negativo')
  const days = daysInYearMonth(yearMonthOf(date))
  const base = Math.floor(monthlyAmount / days)
  const leftover = monthlyAmount - base * days
  return money(base + (dayOfMonth(date) <= leftover ? 1 : 0))
}

const MAX_HORIZON_DAYS = 366

function addTo(target: Map<LocalDate, Money>, date: LocalDate, amount: Money): void {
  target.set(date, add(target.get(date) ?? ZERO, amount))
}

/**
 * Magnitude 8: projected cash flow. Deterministic: the same facts and the same scenario always
 * give the same line. Nothing here is a forecast with invented confidence: the confirmed line
 * and the estimated one are kept apart, and the breakdown shows every term.
 *
 * Flows whose date already passed are placed on today. Everyday spending starts tomorrow: what is
 * paid by debit leaves that same day, and what is paid with a card leaves on the day its bill is
 * paid. Card spending already made is not estimated: its instalments are known obligations.
 */
export function projectCashFlow(input: ProjectionInput): Projection {
  const { today, end, scenario, history } = input
  const horizon = daysBetween(today, end)
  invariant(horizon >= 0, 'El horizonte de la proyección no puede terminar antes de hoy')
  invariant(horizon <= MAX_HORIZON_DAYS, 'El horizonte de la proyección es demasiado largo')

  const usesVariableEstimate = history.sufficient
  const monthlyVariableEstimate = usesVariableEstimate ? history[scenario.variableSpend] : null
  const cards = new Map((input.cards ?? []).map((card) => [card.id, card]))

  const confirmedByDay = new Map<LocalDate, Money>()
  const estimatedByDay = new Map<LocalDate, Money>()
  const variableByDay = new Map<LocalDate, Money>()
  let confirmedIn = ZERO
  let confirmedOut = ZERO
  let estimatedIn = ZERO
  let estimatedOut = ZERO
  let variableSpend = ZERO

  for (const flow of input.flows) {
    if (flow.date > end || flow.amount === 0) {
      continue
    }
    const date = flow.date < today ? today : flow.date
    if (flow.certainty === 'confirmed') {
      addTo(confirmedByDay, date, flow.amount)
      if (flow.amount > 0) {
        confirmedIn = add(confirmedIn, flow.amount)
      } else {
        confirmedOut = add(confirmedOut, negate(flow.amount))
      }
    } else if (flow.amount < 0) {
      addTo(estimatedByDay, date, flow.amount)
      estimatedOut = add(estimatedOut, negate(flow.amount))
    } else if (scenario.includeEstimatedInflows) {
      addTo(estimatedByDay, date, flow.amount)
      estimatedIn = add(estimatedIn, flow.amount)
    }
  }

  if (monthlyVariableEstimate !== null) {
    for (let offset = 1; offset <= horizon; offset += 1) {
      const date = addDays(today, offset)
      const byDebit = dailyShare(monthlyVariableEstimate.liquid, date)
      addTo(variableByDay, date, byDebit)
      variableSpend = add(variableSpend, byDebit)
      for (const [cardId, monthly] of monthlyVariableEstimate.byCard) {
        const card = cards.get(cardId)
        const billed = card === undefined ? date : cardDueDate(card, date)
        if (billed <= end) {
          const byCard = dailyShare(monthly, date)
          addTo(variableByDay, billed, byCard)
          variableSpend = add(variableSpend, byCard)
        }
      }
    }
  }

  const points: ProjectionPoint[] = []
  let confirmed = input.liquidBalance
  let projected = input.liquidBalance
  let lowest: ProjectionPoint | undefined
  let firstNegativeDate: LocalDate | null = null

  for (let offset = 0; offset <= horizon; offset += 1) {
    const date = addDays(today, offset)
    const confirmedToday = confirmedByDay.get(date) ?? ZERO
    confirmed = add(confirmed, confirmedToday)
    projected = subtract(
      add(add(projected, confirmedToday), estimatedByDay.get(date) ?? ZERO),
      variableByDay.get(date) ?? ZERO,
    )
    const point: ProjectionPoint = { date, confirmed, projected }
    points.push(point)
    if (lowest === undefined || projected < lowest.projected) {
      lowest = point
    }
    if (firstNegativeDate === null && projected < 0) {
      firstNegativeDate = date
    }
  }

  return {
    scenario,
    today,
    end,
    points,
    endConfirmed: confirmed,
    endProjected: projected,
    lowestProjected: lowest ?? { date: today, confirmed, projected },
    firstNegativeDate,
    usesVariableEstimate,
    monthlyVariableEstimate,
    breakdown: {
      startBalance: input.liquidBalance,
      confirmedIn,
      confirmedOut,
      estimatedIn,
      estimatedOut,
      variableSpend,
    },
  }
}

export type HorizonKey = 'week' | 'month_end' | 'days_30' | 'days_60' | 'days_90'

export interface Horizon {
  readonly key: HorizonKey
  readonly end: LocalDate
}

/** The five horizons of the specification: 7 days, end of month, 30, 60 and 90 days. */
export function horizons(today: LocalDate): Horizon[] {
  return [
    { key: 'week', end: addDays(today, 7) },
    { key: 'month_end', end: lastDayOf(yearMonthOf(today)) },
    { key: 'days_30', end: addDays(today, 30) },
    { key: 'days_60', end: addDays(today, 60) },
    { key: 'days_90', end: addDays(today, 90) },
  ]
}
