import {
  type Account,
  type AccountId,
  type Budget,
  type Goal,
  type GoalReservation,
  type LocalDate,
  type RecurringRule,
  type Settlement,
  type SharedExpense,
  type Transaction,
  addDays,
  addMonths,
  cardStatement,
  dayInMonth,
  dayOfMonth,
  daysBetween,
  defaultInstallmentPlan,
  equalShares,
  firstDayOf,
  lastDayOf,
  money,
  occurrenceDates,
  outstandingDueBy,
  toId,
  yearMonthOf,
} from '@/domain'
import type { Instant } from '../environment'
import type { ProfileDescriptor } from '../profiles'
import type { ProfileSnapshot } from '../records'
import { emptyProfile } from '../seed'

/**
 * The invented finances of the Demo profile.
 *
 * Nothing here is anybody's money. Every name carries «(demo)» or «de ejemplo», every identifier
 * starts with `demo-`, and the whole set lives in its own database: it cannot reach the profiles
 * of Pablo or Diego, and a Demo backup is refused by a personal profile.
 *
 * The data is built from «today» backwards (about four months), always the same for the same day.
 */

/** The mark every invented name carries. */
export const DEMO_MARK = '(demo)'

const MONTHS_OF_HISTORY = 4
/** Programmed movements of the last days are left unconfirmed, so the Demo shows something pending. */
const UNCONFIRMED_DAYS = 2

type Draft<T> = T extends unknown ? Omit<T, 'id' | 'voided'> : never

const CASH: AccountId = toId('demo-efectivo')
const CHECKING: AccountId = toId('demo-corriente')
const SAVINGS: AccountId = toId('demo-ahorro')
const CARD: AccountId = toId('demo-tarjeta')

export function buildDemoSnapshot(profile: ProfileDescriptor, today: LocalDate, now: Instant): ProfileSnapshot {
  const stamp = { createdAt: now, updatedAt: now }
  const thisMonth = yearMonthOf(today)
  const firstMonth = addMonths(thisMonth, -MONTHS_OF_HISTORY)
  const start = firstDayOf(firstMonth)
  const me = profile.memberId
  const other = profile.members.find((member) => member.id !== me)?.id ?? me
  const everyone = profile.members.map((member) => member.id)

  const account = (id: AccountId, name: string, kind: Account['kind'], opening: number, extra = {}): Account => ({
    id,
    name: `${name} ${DEMO_MARK}`,
    kind,
    openingBalance: money(opening),
    openingDate: start,
    archived: false,
    ...extra,
  })
  const card = account(CARD, 'Tarjeta de crédito', 'credit_card', 0, { paymentDay: 5, statementDay: 20 })
  const accounts: Account[] = [
    account(CASH, 'Efectivo', 'cash', 40_000),
    account(CHECKING, 'Cuenta corriente', 'checking', 900_000),
    account(SAVINGS, 'Cuenta de ahorro', 'savings', 250_000),
    card,
  ]

  const rule = (id: string, label: string, amount: number, day: number, extra: Partial<RecurringRule>): RecurringRule => ({
    id: toId(`demo-regla-${id}`),
    kind: 'expense',
    label: `${label} de ejemplo`,
    amount: money(amount),
    amountIsEstimate: false,
    accountId: CHECKING,
    frequency: 'monthly',
    interval: 1,
    startDate: dayInMonth(firstMonth, day),
    paused: false,
    ...extra,
  })
  const rules: RecurringRule[] = [
    rule('sueldo', 'Sueldo', 1_150_000, 1, { kind: 'income', categoryId: toId('sueldo') }),
    rule('ahorro', 'Ahorro mensual', 80_000, 3, { kind: 'transfer', toAccountId: SAVINGS }),
    rule('arriendo', 'Arriendo', 380_000, 5, { categoryId: toId('arriendo') }),
    rule('internet', 'Internet', 21_990, 12, { categoryId: toId('internet'), accountId: CARD }),
    rule('luz', 'Luz', 28_000, 18, { categoryId: toId('luz'), amountIsEstimate: true }),
  ]
  const skipped = { ruleId: toId<'rule'>('demo-regla-internet'), dueDate: dayInMonth(addMonths(firstMonth, 1), 12) }

  const transactions: Transaction[] = []
  const add = (transaction: Draft<Transaction>): void => {
    const id = toId<'transaction'>(`demo-mov-${String(transactions.length + 1).padStart(4, '0')}`)
    transactions.push({ ...transaction, id, voided: false })
  }
  const note = (text: string): string => `${text} ${DEMO_MARK}`

  const sharedBought = addDays(start, 9)
  const sharedOwed = addDays(start, 20)
  const settledOn = addDays(start, 30)
  const sharedExpenses: SharedExpense[] = [
    {
      id: toId('demo-hogar-1'),
      date: sharedBought,
      description: `Supermercado compartido ${DEMO_MARK}`,
      categoryId: toId('supermercado'),
      total: money(64_000),
      payerId: me,
      shares: equalShares(everyone),
      authorId: me,
      voided: false,
    },
    {
      id: toId('demo-hogar-2'),
      date: sharedOwed,
      description: `Cuentas del mes ${DEMO_MARK}`,
      categoryId: toId('agua'),
      total: money(90_000),
      payerId: other,
      shares: equalShares(everyone),
      authorId: other,
      voided: false,
    },
  ]
  const settlements: Settlement[] = [
    {
      id: toId('demo-reembolso-1'),
      date: settledOn,
      fromMemberId: me,
      toMemberId: other,
      amount: money(8_000),
      authorId: me,
      voided: false,
    },
  ]

  const confirmUntil = addDays(today, -UNCONFIRMED_DAYS)
  const dueOn = new Map<LocalDate, RecurringRule[]>()
  for (const item of rules) {
    for (const date of occurrenceDates(item, start, confirmUntil)) {
      dueOn.set(date, [...(dueOn.get(date) ?? []), item])
    }
  }

  const days = daysBetween(start, today)
  for (let index = 0; index <= days; index += 1) {
    const date = addDays(start, index)

    for (const item of dueOn.get(date) ?? []) {
      if (item.id === skipped.ruleId && date === skipped.dueDate) {
        continue
      }
      const occurrence = { ruleId: item.id, dueDate: date }
      const label = note(item.label)
      if (item.kind === 'income' && item.categoryId !== undefined) {
        add({ kind: 'income', date, amount: item.amount, accountId: item.accountId, categoryId: item.categoryId, occurrence, note: label })
      } else if (item.kind === 'transfer' && item.toAccountId !== undefined) {
        add({ kind: 'transfer', date, amount: item.amount, fromAccountId: item.accountId, toAccountId: item.toAccountId, occurrence, note: label })
      } else if (item.categoryId !== undefined) {
        // The electricity bill is an estimate: the real amount is a little different every month.
        const amount = item.amountIsEstimate ? money(24_000 + ((index * 1_730) % 9_000)) : item.amount
        add({
          kind: 'expense',
          date,
          amount,
          accountId: item.accountId,
          categoryId: item.categoryId,
          occurrence,
          note: label,
          ...(item.accountId === CARD ? { installments: defaultInstallmentPlan(card, date) } : {}),
        })
      }
    }

    // Paying the card: a transfer for exactly what is due that day. Never a second expense.
    if (dayOfMonth(date) === 5) {
      const due = outstandingDueBy(cardStatement(card, transactions, date), date)
      if (due > 0) {
        add({ kind: 'transfer', date, amount: due, fromAccountId: CHECKING, toAccountId: CARD, note: note('Pago de la tarjeta') })
      }
    }
    if (dayOfMonth(date) === 15) {
      add({ kind: 'transfer', date, amount: money(20_000), fromAccountId: CHECKING, toAccountId: CASH, note: note('Giro en efectivo') })
    }

    // Everyday spending, on a fixed pattern.
    if (index % 7 === 5) {
      const amount = money(38_000 + ((index * 977) % 30_000))
      const onCard = Math.floor(index / 7) % 2 === 1
      add({ kind: 'expense', date, amount, accountId: onCard ? CARD : CHECKING, categoryId: toId('supermercado'), note: note('Supermercado') })
    }
    if (index % 3 === 1) {
      add({ kind: 'expense', date, amount: money(1_520), accountId: CHECKING, categoryId: toId('transporte'), note: note('Transporte') })
    }
    if (index % 11 === 4) {
      const amount = money(12_000 + ((index * 313) % 18_000))
      add({ kind: 'expense', date, amount, accountId: CARD, categoryId: toId('ocio'), note: note('Salida') })
    }
    if (index % 13 === 6) {
      add({ kind: 'expense', date, amount: money(3_000), accountId: CASH, categoryId: toId('otros-gastos'), note: note('Gasto chico') })
    }
    if (index % 30 === 17) {
      add({ kind: 'expense', date, amount: money(23_500), accountId: CHECKING, categoryId: toId('mascotas'), note: note('Alimento de mascotas') })
    }

    if (index === 25) {
      add({ kind: 'transfer', date, amount: money(90_000), fromAccountId: CHECKING, toAccountId: SAVINGS, goalId: toId('demo-meta-viaje'), note: note('Aporte al viaje') })
    }
    if (index === 40) {
      add({
        kind: 'income',
        date,
        amount: money(423_750),
        accountId: CHECKING,
        categoryId: toId('honorarios'),
        honorarium: { gross: money(500_000), withholding: money(76_250) },
        note: note('Boleta de honorarios'),
      })
    }
    if (index === 45) {
      add({
        kind: 'expense',
        date,
        amount: money(119_970),
        accountId: CARD,
        categoryId: toId('compras'),
        installments: defaultInstallmentPlan(card, date, 3),
        note: note('Compra en 3 cuotas'),
      })
    }
    if (date === sharedBought) {
      add({ kind: 'shared_payment', date, amount: money(64_000), accountId: CHECKING, sharedExpenseId: toId('demo-hogar-1'), note: note('Supermercado compartido') })
    }
    if (date === settledOn) {
      add({ kind: 'settlement', date, amount: money(8_000), accountId: CHECKING, direction: 'paid', settlementId: toId('demo-reembolso-1'), note: note('Reembolso al hogar') })
    }
  }

  const budgets: Budget[] = [
    { categoryId: toId('supermercado'), month: thisMonth, planned: money(260_000), funded: true },
    { categoryId: toId('transporte'), month: thisMonth, planned: money(30_000), funded: true },
    { categoryId: toId('ocio'), month: thisMonth, planned: money(70_000), funded: false },
    { categoryId: toId('mascotas'), month: thisMonth, planned: money(30_000), funded: false },
  ]
  const goals: Goal[] = [
    { id: toId('demo-meta-emergencia'), name: `Fondo de emergencia ${DEMO_MARK}`, target: money(1_500_000), archived: false },
    {
      id: toId('demo-meta-viaje'),
      name: `Viaje de ejemplo ${DEMO_MARK}`,
      target: money(600_000),
      targetDate: lastDayOf(addMonths(thisMonth, 7)),
      archived: false,
    },
  ]
  const reservation = (id: number, afterDays: number, amount: number): GoalReservation => ({
    id: toId(`demo-reserva-${String(id)}`),
    goalId: toId('demo-meta-emergencia'),
    date: addDays(start, afterDays),
    amount: money(amount),
    voided: false,
  })
  const reservations = [reservation(1, 15, 120_000), reservation(2, 50, 60_000), reservation(3, 70, -30_000)]

  const base = emptyProfile(profile, start, now)
  const stamped = <T extends object>(rows: readonly T[]) => rows.map((row) => ({ ...row, ...stamp }))
  return {
    ...base,
    accounts: stamped(accounts),
    transactions: stamped(transactions),
    rules: stamped(rules),
    cancelledOccurrences: stamped([skipped]),
    budgets: stamped(budgets),
    goals: stamped(goals),
    reservations: stamped(reservations),
    sharedExpenses: stamped(sharedExpenses),
    settlements: stamped(settlements),
    audit: [{ seq: 1, at: now, operation: 'profile.seed', changes: [], result: { demo: true } }],
  }
}
