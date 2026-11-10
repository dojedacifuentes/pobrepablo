import fc from 'fast-check'
import { type Account, indexAccounts } from '../accounts'
import type { Budget } from '../budgets'
import { defaultInstallmentPlan } from '../credit-card'
import { type LocalDate, fromEpochDay, makeYearMonth, maxDate, toEpochDay } from '../dates'
import type { Goal, GoalReservation } from '../goals'
import type { Settlement, SharedExpense } from '../household'
import { type AccountId, type MemberId, type TransactionId, toId } from '../ids'
import type { HouseholdView, SnapshotInput } from '../magnitudes'
import { type Money, money } from '../money'
import { type RecurringRule, occurrenceDates } from '../recurring'
import type { OccurrenceRef, Transaction } from '../transactions'
import { CARD, CASH, CHECKING, DIEGO, MEMBERS, PABLO, SAVINGS, account, cat, d } from './builders'

/**
 * Random but valid financial histories for the property tests.
 *
 * Accounts open between January and March 2026 and movements happen from April on, so that no
 * movement is older than its account. «Today» is any day from April to December: a good part of
 * every history is therefore dated after today, which is exactly what a wrong clock or an imported
 * file could produce, and the magnitudes must stay coherent anyway.
 */

const FIRST_OPENING = '2026-01-01'
const LAST_OPENING = '2026-03-31'
const FIRST_DAY = '2026-04-01'
const LAST_DAY = '2026-12-28'

export const ALL_ACCOUNTS: readonly AccountId[] = [CASH, CHECKING, SAVINGS, CARD]
export const ASSET_ACCOUNTS: readonly AccountId[] = [CASH, CHECKING, SAVINGS]
const CATEGORIES = ['supermercado', 'arriendo', 'ocio', 'luz'].map(cat)
const GOAL_IDS = ['goal-a', 'goal-b']

export const arbAmount = (max = 3_000_000): fc.Arbitrary<Money> => fc.integer({ min: 1, max }).map(money)

export const arbDate = (from = FIRST_DAY, to = LAST_DAY): fc.Arbitrary<LocalDate> =>
  fc.integer({ min: toEpochDay(d(from)), max: toEpochDay(d(to)) }).map(fromEpochDay)

/** About one in ten entries is voided. */
const arbVoided = fc.integer({ min: 0, max: 9 }).map((n) => n === 0)
const arbRarely = fc.integer({ min: 0, max: 7 }).map((n) => n === 0)

/** A card with or without payment day and statement day, including payment days 29 to 31. */
const arbCardDays = fc.oneof(
  fc.constant({}),
  fc.record({ paymentDay: fc.constantFrom(1, 5, 15, 28, 29, 30, 31) }),
  fc.record({ paymentDay: fc.constantFrom(5, 10, 31), statementDay: fc.constantFrom(1, 15, 20, 25, 31) }),
)

export const arbAccounts: fc.Arbitrary<Account[]> = fc
  .record({
    cash: fc.integer({ min: 0, max: 500_000 }),
    checking: fc.integer({ min: 0, max: 5_000_000 }),
    savings: fc.integer({ min: 0, max: 5_000_000 }),
    cardDebt: fc.integer({ min: -100_000, max: 1_000_000 }),
    cardDays: arbCardDays,
    openings: fc.tuple(
      arbDate(FIRST_OPENING, LAST_OPENING),
      arbDate(FIRST_OPENING, LAST_OPENING),
      arbDate(FIRST_OPENING, LAST_OPENING),
      arbDate(FIRST_OPENING, LAST_OPENING),
    ),
    archivedSavings: arbRarely,
  })
  .map(({ cash, checking, savings, cardDebt, cardDays, openings, archivedSavings }) => [
    account(CASH, 'cash', cash, { openingDate: openings[0] }),
    account(CHECKING, 'checking', checking, { openingDate: openings[1] }),
    account(SAVINGS, 'savings', savings, { openingDate: openings[2], archived: archivedSavings }),
    account(CARD, 'credit_card', -cardDebt, { openingDate: openings[3], ...cardDays }),
  ])

/** Two different accounts, in order. */
export const arbAccountPair = (ids: readonly AccountId[]): fc.Arbitrary<[AccountId, AccountId]> =>
  fc
    .tuple(fc.nat({ max: ids.length - 1 }), fc.integer({ min: 1, max: ids.length - 1 }))
    .map(([first, offset]): [AccountId, AccountId] => {
      const from = ids[first] ?? CASH
      const to = ids[(first + offset) % ids.length] ?? CHECKING
      return [from, to]
    })

/** A movement still missing its id and the card it may be charged to. */
type Draft = (id: TransactionId, card: Account) => Transaction

const arbExpenseDraft: fc.Arbitrary<Draft> = fc
  .record({
    date: arbDate(),
    amount: arbAmount(),
    accountId: fc.constantFrom(...ALL_ACCOUNTS),
    categoryId: fc.constantFrom(...CATEGORIES),
    installments: fc.integer({ min: 1, max: 12 }),
    explicitPlan: fc.boolean(),
    voided: arbVoided,
  })
  .map(
    ({ installments, explicitPlan, ...fields }): Draft =>
      (id, card) => ({
        kind: 'expense',
        id,
        ...fields,
        ...(fields.accountId === CARD && explicitPlan && installments <= fields.amount
          ? { installments: defaultInstallmentPlan(card, fields.date, installments) }
          : {}),
      }),
  )

const arbIncomeDraft: fc.Arbitrary<Draft> = fc
  .record({
    date: arbDate(),
    amount: arbAmount(),
    // An income on the card is a refund.
    accountId: fc.constantFrom(CASH, CHECKING, CHECKING, SAVINGS, CARD),
    withholding: fc.option(fc.integer({ min: 0, max: 400_000 }), { nil: undefined }),
    voided: arbVoided,
  })
  .map(
    ({ withholding, ...fields }): Draft =>
      (id) => ({
        kind: 'income',
        id,
        categoryId: cat('sueldo'),
        ...fields,
        ...(withholding !== undefined
          ? { honorarium: { gross: money(fields.amount + withholding), withholding: money(withholding) } }
          : {}),
      }),
  )

const arbTransferDraft: fc.Arbitrary<Draft> = fc
  .record({
    date: arbDate(),
    amount: arbAmount(),
    pair: arbAccountPair(ALL_ACCOUNTS),
    goal: fc.option(fc.constantFrom(...GOAL_IDS), { nil: undefined }),
    voided: arbVoided,
  })
  .map(({ pair, goal, ...fields }): Draft => {
    // A goal only makes sense when exactly one side is the savings account.
    const touchesSavings = (pair[0] === SAVINGS) !== (pair[1] === SAVINGS)
    return (id) => ({
      kind: 'transfer',
      id,
      fromAccountId: pair[0],
      toAccountId: pair[1],
      ...fields,
      ...(goal !== undefined && touchesSavings ? { goalId: toId(goal) } : {}),
    })
  })

const arbAdjustmentDraft: fc.Arbitrary<Draft> = fc
  .record({
    date: arbDate(),
    amount: fc
      .integer({ min: -200_000, max: 200_000 })
      .filter((value) => value !== 0)
      .map(money),
    accountId: fc.constantFrom(...ALL_ACCOUNTS),
    voided: arbVoided,
  })
  .map(
    (fields): Draft =>
      (id) => ({ kind: 'adjustment', id, ...fields }),
  )

const arbSharedPaymentDraft: fc.Arbitrary<Draft> = fc
  .record({ date: arbDate(), amount: arbAmount(), accountId: fc.constantFrom(CASH, CHECKING, CARD), voided: arbVoided })
  .map(
    (fields): Draft =>
      (id) => ({ kind: 'shared_payment', id, sharedExpenseId: toId(`paid-${id}`), ...fields }),
  )

const arbSettlementDraft: fc.Arbitrary<Draft> = fc
  .record({
    date: arbDate(),
    amount: arbAmount(500_000),
    accountId: fc.constantFrom(CASH, CHECKING),
    direction: fc.constantFrom('paid' as const, 'received' as const),
    voided: arbVoided,
  })
  .map(
    (fields): Draft =>
      (id) => ({ kind: 'settlement', id, settlementId: toId(`moved-${id}`), ...fields }),
  )

const arbDraft: fc.Arbitrary<Draft> = fc.oneof(
  { weight: 5, arbitrary: arbExpenseDraft },
  { weight: 2, arbitrary: arbIncomeDraft },
  { weight: 2, arbitrary: arbTransferDraft },
  { weight: 1, arbitrary: arbAdjustmentDraft },
  { weight: 1, arbitrary: arbSharedPaymentDraft },
  { weight: 1, arbitrary: arbSettlementDraft },
)

const arbDrafts = (maxLength = 30): fc.Arbitrary<Draft[]> => fc.array(arbDraft, { maxLength })

function cardOf(accounts: readonly Account[]): Account {
  return accounts.find((item) => item.id === CARD) ?? account(CARD, 'credit_card')
}

function materialise(drafts: readonly Draft[], accounts: readonly Account[]): Transaction[] {
  const card = cardOf(accounts)
  return drafts.map((draft, index) => draft(toId(`t${String(index).padStart(3, '0')}`), card))
}

export interface Ledger {
  readonly accounts: Account[]
  readonly transactions: Transaction[]
}

/** Accounts and a history of movements on them. */
export const arbLedger: fc.Arbitrary<Ledger> = fc
  .tuple(arbAccounts, arbDrafts())
  .map(([accounts, drafts]) => ({ accounts, transactions: materialise(drafts, accounts) }))

/** One more movement, with a given id, for the same accounts. */
export const arbExtraTransaction = (id = 'extra'): fc.Arbitrary<(accounts: readonly Account[]) => Transaction> =>
  arbDraft.map((draft) => (accounts: readonly Account[]) => draft(toId(id), cardOf(accounts)))

export const arbRules: fc.Arbitrary<RecurringRule[]> = fc
  .array(
    fc.record({
      kind: fc.constantFrom('expense' as const, 'income' as const, 'transfer' as const),
      amount: arbAmount(800_000),
      amountIsEstimate: fc.boolean(),
      pair: arbAccountPair(ALL_ACCOUNTS),
      categoryId: fc.constantFrom(...CATEGORIES),
      frequency: fc.constantFrom('weekly' as const, 'monthly' as const, 'yearly' as const),
      interval: fc.integer({ min: 1, max: 3 }),
      // Some rules start before their account was opened: those occurrences must not count.
      startDate: arbDate(FIRST_OPENING, LAST_DAY),
      lastsDays: fc.option(fc.integer({ min: 0, max: 200 }), { nil: undefined }),
      paused: arbRarely,
    }),
    { maxLength: 4 },
  )
  .map((drafts) =>
    drafts.map(({ pair, categoryId, lastsDays, ...fields }, index): RecurringRule => {
      const base = {
        id: toId<'rule'>(`rule-${String(index)}`),
        label: `rule-${String(index)}`,
        ...fields,
        ...(lastsDays !== undefined ? { endDate: fromEpochDay(toEpochDay(fields.startDate) + lastsDays) } : {}),
      }
      if (fields.kind === 'transfer') {
        return { ...base, accountId: pair[0], toAccountId: pair[1] }
      }
      // Programmed income never lands on a credit card in these histories.
      const accountId = fields.kind === 'income' && pair[0] === CARD ? CHECKING : pair[0]
      return { ...base, accountId, categoryId }
    }),
  )

export const arbBudgets: fc.Arbitrary<Budget[]> = fc
  .uniqueArray(
    fc.record({
      category: fc.nat({ max: CATEGORIES.length - 1 }),
      month: fc.integer({ min: 4, max: 12 }),
      planned: fc.integer({ min: 0, max: 1_500_000 }),
      funded: fc.boolean(),
    }),
    { maxLength: 6, selector: (entry) => `${String(entry.category)}-${String(entry.month)}` },
  )
  .map((entries) =>
    entries.map(
      (entry): Budget => ({
        categoryId: CATEGORIES[entry.category] ?? cat('supermercado'),
        month: makeYearMonth(2026, entry.month),
        planned: money(entry.planned),
        funded: entry.funded,
      }),
    ),
  )

export const arbGoals: fc.Arbitrary<Goal[]> = fc
  .tuple(arbAmount(5_000_000), arbAmount(5_000_000), fc.integer({ min: 0, max: 2 }), arbRarely)
  .map(([first, second, count, archived]) =>
    [first, second].slice(0, count).map(
      (target, index): Goal => ({
        id: toId(GOAL_IDS[index] ?? 'goal-a'),
        name: 'meta',
        target,
        archived: archived && index === 0,
      }),
    ),
  )

export const arbReservations: fc.Arbitrary<GoalReservation[]> = fc
  .array(
    fc.record({
      goal: fc.constantFrom(...GOAL_IDS),
      date: arbDate(),
      amount: fc.integer({ min: -300_000, max: 600_000 }).filter((value) => value !== 0),
      voided: arbVoided,
    }),
    { maxLength: 6 },
  )
  .map((entries) =>
    entries.map(
      (entry, index): GoalReservation => ({
        id: toId(`reservation-${String(index)}`),
        goalId: toId(entry.goal),
        date: entry.date,
        amount: money(entry.amount),
        voided: entry.voided,
      }),
    ),
  )

const arbMemberOf = (members: readonly MemberId[]) => fc.constantFrom(...members)

/** Shared expenses among any group: who paid, and one weight per member (not all zero). */
export const arbSharedExpensesAmong = (members: readonly MemberId[]): fc.Arbitrary<SharedExpense[]> =>
  fc
    .array(
      fc.record({
        date: arbDate(),
        total: arbAmount(1_000_000),
        payerId: arbMemberOf(members),
        weights: fc
          .array(fc.integer({ min: 0, max: 100 }), { minLength: members.length, maxLength: members.length })
          .filter((weights) => weights.some((weight) => weight > 0)),
        voided: arbVoided,
      }),
      { maxLength: 8 },
    )
    .map((entries) =>
      entries.map(
        ({ weights, ...fields }, index): SharedExpense => ({
          id: toId(`shared-${String(index).padStart(2, '0')}`),
          description: 'gasto común',
          categoryId: cat('supermercado'),
          shares: members.map((participantId, position) => ({ participantId, weight: weights[position] ?? 0 })),
          authorId: fields.payerId,
          ...fields,
        }),
      ),
    )

export const arbSettlementsAmong = (members: readonly MemberId[]): fc.Arbitrary<Settlement[]> =>
  fc
    .array(
      fc.record({
        date: arbDate(),
        amount: arbAmount(400_000),
        from: fc.nat({ max: members.length - 1 }),
        offset: fc.integer({ min: 1, max: Math.max(1, members.length - 1) }),
        voided: arbVoided,
      }),
      { maxLength: 5 },
    )
    .map((entries) =>
      entries.map(({ from, offset, ...fields }, index): Settlement => {
        const fromMemberId = members[from] ?? DIEGO
        return {
          id: toId(`settlement-${String(index).padStart(2, '0')}`),
          fromMemberId,
          toMemberId: members[(from + offset) % members.length] ?? PABLO,
          authorId: fromMemberId,
          ...fields,
        }
      }),
    )

export const arbSharedExpenses = arbSharedExpensesAmong(MEMBERS)
export const arbSettlements = arbSettlementsAmong(MEMBERS)

/** A household of three to five people, for the rules that must not depend on there being two. */
export const arbLargeHousehold = fc
  .integer({ min: 3, max: 5 })
  .map((size) => Array.from({ length: size }, (_, index): MemberId => toId(`member-${String(index)}`)))
  .chain((members) =>
    fc.record({
      members: fc.constant(members),
      expenses: arbSharedExpensesAmong(members),
      settlements: arbSettlementsAmong(members),
    }),
  )

export const arbHousehold: fc.Arbitrary<HouseholdView> = fc
  .record({ memberId: arbMemberOf(MEMBERS), expenses: arbSharedExpenses, settlements: arbSettlements })
  .map((view) => ({ ...view, members: MEMBERS }))

/**
 * A whole financial situation: accounts, history, rules, budgets, goals and the household.
 * Some programmed expenses are already confirmed by a movement and some were skipped.
 */
export const arbSnapshotInput: fc.Arbitrary<SnapshotInput> = fc
  .record({
    accounts: arbAccounts,
    drafts: arbDrafts(),
    rules: arbRules,
    resolutions: fc.array(fc.constantFrom('confirm' as const, 'cancel' as const, 'leave' as const), {
      minLength: 12,
      maxLength: 12,
    }),
    budgets: arbBudgets,
    goals: arbGoals,
    reservations: arbReservations,
    household: arbHousehold,
    today: arbDate(),
  })
  .map(({ drafts, resolutions, ...input }): SnapshotInput => {
    const accounts = indexAccounts(input.accounts)
    const card = cardOf(input.accounts)
    const { rules } = input
    const transactions = materialise(drafts, input.accounts)
    const cancelledOccurrences: OccurrenceRef[] = []

    let position = 0
    for (const rule of rules) {
      if (rule.kind !== 'expense' || rule.categoryId === undefined) {
        continue
      }
      const opening = accounts.get(rule.accountId)?.openingDate ?? rule.startDate
      for (const dueDate of occurrenceDates(rule, maxDate(rule.startDate, opening), d(LAST_DAY)).slice(0, 4)) {
        const resolution = resolutions[position % resolutions.length]
        position += 1
        const ref = { ruleId: rule.id, dueDate }
        if (resolution === 'cancel') {
          cancelledOccurrences.push(ref)
        } else if (resolution === 'confirm') {
          transactions.push({
            kind: 'expense',
            id: toId(`confirmation-${String(position)}`),
            date: dueDate,
            amount: rule.amount,
            accountId: rule.accountId,
            categoryId: rule.categoryId,
            voided: false,
            occurrence: ref,
            ...(rule.accountId === CARD ? { installments: defaultInstallmentPlan(card, dueDate) } : {}),
          })
        }
      }
    }

    return { ...input, transactions, cancelledOccurrences }
  })

/**
 * A whole financial situation in which a programmed expense is certainly being counted twice:
 * it is still waiting, and a shared expense of the same category and the same month, paid by the
 * other member of the household, already charged the person their part.
 *
 * Fewer than two random situations in a hundred contain that by chance, so a property that needs
 * it cannot rely on luck: here the pair is always put in. It uses a category of its own, so that
 * it never collides with what the rest of the situation generates.
 */
export const arbCoverableSnapshotInput: fc.Arbitrary<SnapshotInput> = fc
  .record({
    input: arbSnapshotInput,
    amount: arbAmount(800_000),
    // At least two pesos: split in two, one peso would leave one of the two members with no part.
    total: fc.integer({ min: 2, max: 1_000_000 }).map(money),
    day: fc.integer({ min: 1, max: 28 }),
    monthsBack: fc.integer({ min: 0, max: 2 }),
    amountIsEstimate: fc.boolean(),
    onCard: fc.boolean(),
  })
  .map(({ input, amount, total, day, monthsBack, amountIsEstimate, onCard }): SnapshotInput => {
    const household = input.household
    if (household === undefined) {
      return input
    }
    const other = household.members.find((member) => member !== household.memberId) ?? household.memberId
    // Never before April: by then every account of these situations is open.
    const month = Math.max(4, Number(input.today.slice(5, 7)) - monthsBack)
    const dueDate = d(`2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
    const rule: RecurringRule = {
      id: toId('rule-covered'),
      kind: 'expense',
      label: 'rule-covered',
      amount,
      amountIsEstimate,
      accountId: onCard ? CARD : CHECKING,
      categoryId: cat('internet'),
      frequency: 'yearly',
      interval: 1,
      startDate: dueDate,
      paused: false,
    }
    const expense: SharedExpense = {
      id: toId('shared-covering'),
      // The first day of that month is never after today.
      date: d(`2026-${String(month).padStart(2, '0')}-01`),
      description: 'gasto común que cubre',
      categoryId: cat('internet'),
      total,
      payerId: other,
      shares: household.members.map((participantId) => ({ participantId, weight: 1 })),
      authorId: other,
      voided: false,
    }
    return {
      ...input,
      rules: [...input.rules, rule],
      household: { ...household, expenses: [...household.expenses, expense] },
    }
  })
