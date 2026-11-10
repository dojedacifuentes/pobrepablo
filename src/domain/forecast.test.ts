import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { addDays } from './dates'
import { firstActivityDate, projectFinances, projectScenarios, variableSpendHistory } from './forecast'
import type { SnapshotInput } from './magnitudes'
import { add, subtract } from './money'
import { SCENARIOS } from './projection'
import { arbSnapshotInput } from './testing/arbitraries'
import { CARD, CHECKING, SAVINGS, account, cat, clp, d, expense, rule } from './testing/builders'

const today = d('2026-11-10')

/** Registering since 1 June: July to October are four complete months of history. */
function situation(overrides: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    accounts: [
      account(CHECKING, 'checking', 3_000_000, { openingDate: d('2026-06-01') }),
      account(SAVINGS, 'savings', 0, { openingDate: d('2026-06-01') }),
      account(CARD, 'credit_card', 0, { openingDate: d('2026-06-01'), paymentDay: 5 }),
    ],
    transactions: [
      expense('jul', '2026-07-10', 300_000),
      expense('ago', '2026-08-10', 300_000),
      expense('sep', '2026-09-10', 300_000),
      expense('oct', '2026-10-10', 300_000),
      // Bought with the card two days ago: it will be paid with the bill of 5 December.
      expense('tarjeta', '2026-11-08', 60_000, CARD),
    ],
    rules: [
      rule('arriendo', '2026-11-15', 400_000),
      rule('sueldo', '2026-11-25', 1_000_000, { kind: 'income', categoryId: cat('sueldo') }),
    ],
    cancelledOccurrences: [],
    budgets: [],
    goals: [],
    reservations: [],
    today,
    ...overrides,
  }
}

describe('proyección desde los datos guardados', () => {
  it('encadena saldo, compromisos, cuotas de tarjeta e historial', () => {
    const input = situation()
    expect(firstActivityDate(input)).toBe('2026-06-01')
    expect(variableSpendHistory(input)).toMatchObject({ monthsAvailable: 4, sufficient: true })

    const projection = projectFinances(input, d('2026-12-10'), SCENARIOS.central)
    expect(projection.breakdown).toEqual({
      startBalance: 1_800_000,
      confirmedIn: 1_000_000,
      // The rent of 15 November and the card bill of 5 December. December's rent falls on the 15th: outside.
      confirmedOut: 460_000,
      estimatedIn: 0,
      estimatedOut: 0,
      // 300.000 a month by debit: 20 days of November (10.000) and 10 of December (9.678).
      variableSpend: 296_780,
    })
    expect(projection.endConfirmed).toBe(2_340_000)
    expect(projection.endProjected).toBe(2_043_220)
    expect(projection.usesVariableEstimate).toBe(true)
  })

  it('con menos de tres meses completos no estima el gasto cotidiano', () => {
    const recent = situation({
      accounts: [account(CHECKING, 'checking', 3_000_000, { openingDate: d('2026-08-20') })],
      transactions: [expense('sep', '2026-09-10', 300_000), expense('oct', '2026-10-10', 300_000)],
    })
    const projection = projectFinances(recent, d('2026-12-10'), SCENARIOS.central)
    expect(projection.usesVariableEstimate).toBe(false)
    expect(projection.breakdown.variableSpend).toBe(0)
    expect(projection.endProjected).toBe(projection.endConfirmed)
  })

  it('entrega los tres escenarios para el mismo horizonte', () => {
    const scenarios = projectScenarios(situation(), d('2027-02-08'))
    expect(scenarios.conservative.endProjected).toBeLessThanOrEqual(scenarios.central.endProjected)
    expect(scenarios.central.endProjected).toBeLessThanOrEqual(scenarios.optimistic.endProjected)
    expect(scenarios.central.scenario.name).toBe('central')
  })

  it('el simulador trabaja sobre una copia: proyectar no modifica los datos', () => {
    const input = situation()
    const before = JSON.stringify(input)
    projectScenarios(input, d('2027-02-08'))
    // A hypothesis: «what if the rent went up?». Only the copy changes.
    const hypothesis = { ...input, rules: input.rules.map((item) => (item.id === 'arriendo' ? { ...item, amount: add(item.amount, item.amount) } : item)) }
    const base = projectFinances(input, d('2026-12-10'), SCENARIOS.central)
    const simulated = projectFinances(hypothesis, d('2026-12-10'), SCENARIOS.central)
    expect(simulated.endProjected).toBe(subtract(base.endProjected, clp(400_000)))
    expect(JSON.stringify(input)).toBe(before)
  })
})

describe('invariantes de la proyección sobre situaciones completas', () => {
  it('nunca falla, cuadra con su desglose y respeta el orden de los escenarios', () => {
    fc.assert(
      fc.property(arbSnapshotInput, fc.constantFrom(7, 30, 90), (input, days) => {
        const scenarios = projectScenarios(input, addDays(input.today, days))
        for (const projection of Object.values(scenarios)) {
          const { breakdown } = projection
          expect(projection.points).toHaveLength(days + 1)
          expect(projection.endProjected).toBe(
            subtract(
              subtract(
                add(subtract(add(breakdown.startBalance, breakdown.confirmedIn), breakdown.confirmedOut), breakdown.estimatedIn),
                breakdown.estimatedOut,
              ),
              breakdown.variableSpend,
            ),
          )
        }
        expect(scenarios.conservative.endProjected).toBeLessThanOrEqual(scenarios.central.endProjected)
        expect(scenarios.central.endProjected).toBeLessThanOrEqual(scenarios.optimistic.endProjected)
      }),
    )
  })
})
