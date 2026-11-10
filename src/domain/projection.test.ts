import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { indexAccounts } from './accounts'
import { type LocalDate, addDays, daysInYearMonth, firstDayOf, yearMonth, yearMonthOf } from './dates'
import { DomainError } from './errors'
import { type AccountId, toId } from './ids'
import { type Money, ZERO, add, money, subtract, sum } from './money'
import {
  type CashFlow,
  type VariableSpend,
  SCENARIOS,
  collectCashFlows,
  dailyShare,
  historyMonths,
  horizons,
  projectCashFlow,
  summarizeVariableSpend,
  variableSpendByMonth,
} from './projection'
import { listOccurrences } from './recurring'
import { arbAmount, arbDate } from './testing/arbitraries'
import { CARD, CHECKING, SAVINGS, account, baseAccounts, cat, clp, d, expense, rule } from './testing/builders'

const today = d('2026-11-10')
const card = account(CARD, 'credit_card', 0, { paymentDay: 5 })

function spend(liquid: number, onCard?: number): VariableSpend {
  const byCard = new Map<AccountId, Money>()
  if (onCard !== undefined) {
    byCard.set(CARD, clp(onCard))
  }
  return { liquid: clp(liquid), byCard }
}

const insufficient = summarizeVariableSpend([])
const flows: CashFlow[] = [
  { date: d('2026-11-15'), amount: clp(-400_000), certainty: 'confirmed', source: 'obligation', label: 'arriendo' },
  { date: d('2026-11-25'), amount: clp(1_000_000), certainty: 'confirmed', source: 'income', label: 'sueldo' },
  { date: d('2026-11-20'), amount: clp(-30_000), certainty: 'estimated', source: 'obligation', label: 'luz' },
  { date: d('2026-11-28'), amount: clp(200_000), certainty: 'estimated', source: 'income', label: 'proyecto' },
]

describe('gasto cotidiano histórico', () => {
  it('con menos de tres meses completos no hay estimación', () => {
    expect(summarizeVariableSpend([])).toMatchObject({ monthsAvailable: 0, sufficient: false })
    expect(summarizeVariableSpend([spend(300_000), spend(310_000)])).toMatchObject({
      monthsAvailable: 2,
      sufficient: false,
    })
  })

  it('toma el mes más barato, la mediana y el más caro por su total, y los reparte por forma de pago', () => {
    // Totals 300.000, 600.000 and 900.000; two thirds by debit and one third with the card.
    const history = summarizeVariableSpend([spend(200_000, 100_000), spend(600_000, 300_000), spend(400_000, 200_000)])
    expect(history).toMatchObject({ monthsAvailable: 3, sufficient: true })
    expect(history.lowest).toEqual(spend(200_000, 100_000))
    expect(history.median).toEqual(spend(400_000, 200_000))
    expect(history.highest).toEqual(spend(600_000, 300_000))
  })

  it('no se confunde cuando la forma de pago cambia de un mes a otro', () => {
    // 300.000 every month, paid one month by debit, one with a card and one with another card.
    const other: AccountId = toId('otra-tarjeta')
    const months: VariableSpend[] = [
      spend(300_000),
      { liquid: ZERO, byCard: new Map([[CARD, clp(300_000)]]) },
      { liquid: ZERO, byCard: new Map([[other, clp(300_000)]]) },
    ]
    const history = summarizeVariableSpend(months)
    const expected: VariableSpend = {
      liquid: clp(100_000),
      byCard: new Map([
        [CARD, clp(100_000)],
        [other, clp(100_000)],
      ]),
    }
    // The person spends 300.000 a month in every scenario: none of them says zero or 900.000.
    expect(history.lowest).toEqual(expected)
    expect(history.median).toEqual(expected)
    expect(history.highest).toEqual(expected)
  })

  it('la mediana resiste un mes atípico y, con un número par de meses, promedia los dos del medio', () => {
    expect(summarizeVariableSpend([spend(100), spend(400), spend(200), spend(300)]).median.liquid).toBe(250)
    expect(summarizeVariableSpend([spend(100), spend(201), spend(50), spend(900)]).median.liquid).toBe(150)
  })

  it('solo considera meses completos, posteriores al mes en que se empezó a registrar', () => {
    expect(historyMonths(null, today)).toEqual([])
    expect(historyMonths(d('2026-11-09'), d('2027-02-20'))).toEqual(['2026-12', '2027-01'])
    expect(historyMonths(d('2026-11-09'), d('2027-03-15'))).toEqual(['2026-12', '2027-01', '2027-02'])
    expect(historyMonths(d('2025-01-10'), today)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
  })

  it('separa lo pagado con débito de lo pagado con tarjeta y deja fuera los recurrentes', () => {
    const accounts = indexAccounts(baseAccounts())
    const recurring = { ruleId: rule('r', '2026-01-05', 1).id, dueDate: d('2026-10-05') }
    const history = [
      expense('e1', '2026-10-03', 45_000),
      expense('e2', '2026-10-05', 420_000, CHECKING, { occurrence: recurring }),
      expense('e3', '2026-09-12', 20_000),
      expense('e4', '2026-10-10', 30_000, CARD),
      expense('e5', '2026-10-11', 99_000, SAVINGS),
      { ...expense('e6', '2026-10-12', 77_000), voided: true },
    ]
    const shares = [{ sharedExpenseId: toId<'sharedExpense'>('s1'), date: d('2026-10-15'), categoryId: cat('supermercado'), amount: clp(10_000) }]
    const months = [yearMonth('2026-09'), yearMonth('2026-10')]
    expect(variableSpendByMonth(history, shares, months, accounts)).toEqual([spend(20_000), spend(55_000, 30_000)])
    // The part of a shared expense that belongs to a recurring rule is not everyday spending.
    expect(variableSpendByMonth(history, shares, months, accounts, new Set(['s1']))).toEqual([
      spend(20_000),
      spend(45_000, 30_000),
    ])
  })
})

/** The estimate for a stretch of consecutive days. */
function shareBetween(monthly: Money, from: LocalDate, days: number): Money {
  return sum(Array.from({ length: days }, (_, index) => dailyShare(monthly, addDays(from, index))))
}

describe('reparto diario de una estimación mensual', () => {
  it('los días de un mes suman exactamente el mes', () => {
    fc.assert(
      fc.property(arbAmount(), arbDate('2026-01-01', '2028-12-31'), (monthly, date) => {
        const month = yearMonthOf(date)
        expect(shareBetween(monthly, firstDayOf(month), daysInYearMonth(month))).toBe(monthly)
        expect(dailyShare(monthly, date)).toBeGreaterThanOrEqual(0)
      }),
    )
  })

  it('una estimación mayor nunca da menos gasto para ningún tramo de días', () => {
    fc.assert(
      fc.property(
        arbAmount(),
        arbAmount(),
        arbDate('2026-01-01', '2028-12-31'),
        fc.integer({ min: 1, max: 120 }),
        (first, second, from, days) => {
          const smaller = first <= second ? first : second
          const larger = first <= second ? second : first
          expect(shareBetween(smaller, from, days)).toBeLessThanOrEqual(shareBetween(larger, from, days))
        },
      ),
    )
  })

  it('no acepta una estimación negativa', () => {
    expect(() => dailyShare(clp(-1), today)).toThrow(DomainError)
  })
})

describe('flujo de caja proyectado', () => {
  const project = (overrides: Partial<Parameters<typeof projectCashFlow>[0]> = {}) =>
    projectCashFlow({
      today,
      end: d('2026-11-30'),
      liquidBalance: clp(600_000),
      flows,
      history: insufficient,
      scenario: SCENARIOS.central,
      ...overrides,
    })

  it('sin historial suficiente proyecta solo con compromisos y lo dice', () => {
    const projection = project()
    expect(projection.usesVariableEstimate).toBe(false)
    expect(projection.monthlyVariableEstimate).toBeNull()
    expect(projection.points).toHaveLength(21)
    expect(projection.points[0]).toEqual({ date: '2026-11-10', confirmed: 600_000, projected: 600_000 })
    expect(projection.endConfirmed).toBe(1_200_000)
    expect(projection.endProjected).toBe(1_370_000)
    expect(projection.lowestProjected).toEqual({ date: '2026-11-20', confirmed: 200_000, projected: 170_000 })
    expect(projection.firstNegativeDate).toBeNull()
    expect(projection.breakdown).toEqual({
      startBalance: 600_000,
      confirmedIn: 1_000_000,
      confirmedOut: 400_000,
      estimatedIn: 200_000,
      estimatedOut: 30_000,
      variableSpend: 0,
    })
  })

  it('cada escenario declara sus supuestos y los aplica', () => {
    const history = summarizeVariableSpend([spend(300_000), spend(310_000), spend(900_000)])
    const run = (name: keyof typeof SCENARIOS) => project({ history, scenario: SCENARIOS[name] })

    // Central: the median month (310.000) over 11–30 November: 20 days at 10.333.
    expect(run('central').breakdown.variableSpend).toBe(206_660)
    expect(run('central').endProjected).toBe(1_163_340)
    // Conservative: no estimated income, and the most expensive month (900.000 → 600.000).
    expect(run('conservative').breakdown).toMatchObject({ estimatedIn: 0, variableSpend: 600_000 })
    expect(run('conservative').endProjected).toBe(570_000)
    // Optimistic: the cheapest month (300.000 → 200.000).
    expect(run('optimistic').endProjected).toBe(1_170_000)
    // The confirmed line is the same in every scenario.
    expect(run('conservative').endConfirmed).toBe(run('optimistic').endConfirmed)
  })

  it('el gasto cotidiano con tarjeta sale de la cuenta cuando se paga la tarjeta, no el día de la compra', () => {
    const history = summarizeVariableSpend([spend(0, 300_000), spend(0, 300_000), spend(0, 300_000)])
    const projection = project({
      end: d('2026-12-10'),
      liquidBalance: clp(1_000_000),
      flows: [],
      history,
      cards: [card],
    })
    const at = (date: string) => projection.points.find((point) => point.date === date)?.projected
    // Purchases from 11 November to 4 December are billed on 5 December: 20 × 10.000 + 4 × 9.678.
    expect(at('2026-12-04')).toBe(1_000_000)
    expect(at('2026-12-05')).toBe(761_288)
    // What is bought from 5 December on is billed in January, beyond this horizon.
    expect(projection.endProjected).toBe(761_288)
    expect(projection.breakdown.variableSpend).toBe(238_712)
  })

  it('avisa el primer día en que el saldo proyectado baja de cero', () => {
    const projection = project({ liquidBalance: clp(300_000), scenario: SCENARIOS.conservative })
    expect(projection.firstNegativeDate).toBe('2026-11-15')
    expect(projection.lowestProjected.projected).toBe(-130_000)
  })

  it('lo vencido se cobra hoy y lo que cae después del horizonte no entra', () => {
    const projection = project({
      end: d('2026-11-17'),
      liquidBalance: clp(100_000),
      flows: [
        { date: d('2026-11-05'), amount: clp(-50_000), certainty: 'confirmed', source: 'obligation', label: 'tarjeta' },
        { date: d('2026-11-18'), amount: clp(-70_000), certainty: 'confirmed', source: 'obligation', label: 'después' },
      ],
    })
    expect(projection.points[0]?.confirmed).toBe(50_000)
    expect(projection.endConfirmed).toBe(50_000)
  })

  it('rechaza horizontes imposibles', () => {
    expect(() => project({ end: d('2026-11-09') })).toThrow(DomainError)
    expect(() => project({ end: d('2028-01-01') })).toThrow(DomainError)
  })

  it('ofrece los cinco horizontes de la especificación', () => {
    expect(horizons(today)).toEqual([
      { key: 'week', end: '2026-11-17' },
      { key: 'month_end', end: '2026-11-30' },
      { key: 'days_30', end: '2026-12-10' },
      { key: 'days_60', end: '2027-01-09' },
      { key: 'days_90', end: '2027-02-08' },
    ])
  })

  it('reúne los flujos conocidos sin contar dos veces el pago de la tarjeta', () => {
    const accounts = indexAccounts(baseAccounts())
    const rules = [
      rule('sueldo', '2026-11-25', 1_000_000, { kind: 'income', categoryId: cat('sueldo') }),
      rule('atrasado', '2026-11-03', 80_000, { kind: 'income', categoryId: cat('ocasional'), endDate: d('2026-11-03') }),
      rule('ahorro', '2026-11-26', 50_000, { kind: 'transfer', toAccountId: SAVINGS }),
      rule('pago-tarjeta', '2026-11-27', 90_000, { kind: 'transfer', toAccountId: CARD }),
    ]
    const occurrences = listOccurrences({ rules, transactions: [], cancelled: [], accounts, today, through: d('2026-11-30') })
    const collected = collectCashFlows({
      occurrences,
      accounts,
      obligations: [
        { source: 'card', ref: 'card:e1:1', label: 'card', dueDate: d('2026-11-27'), amount: clp(90_000), certainty: 'confirmed' },
      ],
    })
    expect(collected.map((flow) => [flow.date, flow.amount, flow.certainty, flow.source])).toEqual([
      ['2026-11-03', 80_000, 'estimated', 'income'],
      ['2026-11-25', 1_000_000, 'confirmed', 'income'],
      ['2026-11-26', -50_000, 'confirmed', 'transfer'],
      ['2026-11-27', -90_000, 'confirmed', 'obligation'],
    ])
  })
})

const arbFlows: fc.Arbitrary<CashFlow[]> = fc.array(
  fc.record({
    date: arbDate('2026-10-01', '2027-03-31'),
    amount: fc.integer({ min: -900_000, max: 900_000 }).map(money),
    certainty: fc.constantFrom('confirmed' as const, 'estimated' as const),
    source: fc.constantFrom('obligation' as const, 'income' as const, 'transfer' as const),
    label: fc.constant('flujo'),
  }),
  { maxLength: 25 },
)
const arbHistory = fc
  .array(fc.tuple(fc.integer({ min: 0, max: 900_000 }), fc.option(fc.integer({ min: 0, max: 600_000 }), { nil: undefined })), {
    maxLength: 6,
  })
  .map((months) => summarizeVariableSpend(months.map(([liquid, onCard]) => spend(liquid, onCard))))
const arbCard = fc
  .record({ paymentDay: fc.constantFrom(1, 5, 15, 31), statementDay: fc.option(fc.constantFrom(10, 20, 25), { nil: undefined }) })
  .map(({ paymentDay, statementDay }) =>
    account(CARD, 'credit_card', 0, { paymentDay, ...(statementDay !== undefined ? { statementDay } : {}) }),
  )

describe('invariantes de la proyección', () => {
  it('el saldo final es exactamente la suma de los términos del desglose', () => {
    fc.assert(
      fc.property(
        arbFlows,
        arbHistory,
        arbCard,
        fc.integer({ min: 0, max: 90 }),
        fc.constantFrom(...Object.values(SCENARIOS)),
        (someFlows, history, anyCard, days, scenario) => {
          const projection = projectCashFlow({
            today,
            end: addDays(today, days),
            liquidBalance: clp(500_000),
            flows: someFlows,
            history,
            scenario,
            cards: [anyCard],
          })
          const { breakdown } = projection
          const confirmed = subtract(add(breakdown.startBalance, breakdown.confirmedIn), breakdown.confirmedOut)
          expect(projection.points).toHaveLength(days + 1)
          expect(projection.endConfirmed).toBe(confirmed)
          expect(projection.endProjected).toBe(
            subtract(
              subtract(add(confirmed, breakdown.estimatedIn), breakdown.estimatedOut),
              breakdown.variableSpend,
            ),
          )
          expect(breakdown.variableSpend >= ZERO).toBe(true)
        },
      ),
    )
  })

  it('conservador nunca va por encima del central, ni el central por encima del optimista, ningún día', () => {
    fc.assert(
      fc.property(arbFlows, arbHistory, arbCard, fc.integer({ min: 0, max: 90 }), (someFlows, history, anyCard, days) => {
        const run = (name: keyof typeof SCENARIOS) =>
          projectCashFlow({
            today,
            end: addDays(today, days),
            liquidBalance: clp(500_000),
            flows: someFlows,
            history,
            scenario: SCENARIOS[name],
            cards: [anyCard],
          })
        const conservative = run('conservative')
        const central = run('central')
        const optimistic = run('optimistic')
        for (const [index, point] of central.points.entries()) {
          expect(conservative.points[index]?.projected).toBeLessThanOrEqual(point.projected)
          expect(point.projected).toBeLessThanOrEqual(optimistic.points[index]?.projected ?? point.projected)
        }
        expect(conservative.endConfirmed).toBe(optimistic.endConfirmed)
      }),
    )
  })
})
