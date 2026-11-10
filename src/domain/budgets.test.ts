import { describe, expect, it } from 'vitest'
import { type Budget, budgetStatus, budgetStatuses } from './budgets'
import { yearMonth } from './dates'
import { DomainError } from './errors'
import { cat, clp, d } from './testing/builders'

const november = yearMonth('2026-11')
const budget = (planned: number, funded = false, category = 'supermercado'): Budget => ({
  categoryId: cat(category),
  month: november,
  planned: clp(planned),
  funded,
})
const today = d('2026-11-10')

describe('presupuestos', () => {
  it('planificado, usado, disponible y porcentaje', () => {
    expect(budgetStatus(budget(300_000), clp(150_000), clp(0), today)).toMatchObject({
      planned: 300_000,
      spent: 150_000,
      available: 150_000,
      percentUsed: 50,
      state: 'ok',
      reserved: 0,
    })
  })

  it('avisa cerca del límite y marca el exceso', () => {
    expect(budgetStatus(budget(300_000), clp(269_999), clp(0), today).state).toBe('ok')
    expect(budgetStatus(budget(300_000), clp(270_000), clp(0), today).state).toBe('near')
    expect(budgetStatus(budget(300_000), clp(300_000), clp(0), today)).toMatchObject({
      state: 'near',
      percentUsed: 100,
      available: 0,
    })
    expect(budgetStatus(budget(300_000), clp(300_001), clp(0), today)).toMatchObject({
      state: 'exceeded',
      available: -1,
    })
  })

  it('sin monto planificado no hay porcentaje', () => {
    expect(budgetStatus(budget(0), clp(0), clp(0), today)).toMatchObject({ percentUsed: null, state: 'ok' })
    expect(budgetStatus(budget(0), clp(1), clp(0), today).state).toBe('exceeded')
  })

  it('compara el ritmo de gasto con un uso parejo del mes', () => {
    // On 10 November a steady pace would have used a third of the plan: $100.000 of $300.000.
    expect(budgetStatus(budget(300_000), clp(150_000), clp(0), today).trend).toBe('over')
    expect(budgetStatus(budget(300_000), clp(100_000), clp(0), today).trend).toBe('on_track')
    expect(budgetStatus(budget(300_000), clp(50_000), clp(0), today).trend).toBe('under')
    expect(budgetStatus(budget(300_000), clp(250_000), clp(0), d('2026-12-02')).trend).toBe('under')
  })

  it('un presupuesto con fondo reserva lo que aún no se gasta ni está comprometido', () => {
    expect(budgetStatus(budget(420_000, true, 'arriendo'), clp(0), clp(0), today).reserved).toBe(420_000)
    // The rent is already a pending obligation: reserving it too would count it twice.
    expect(budgetStatus(budget(420_000, true, 'arriendo'), clp(0), clp(420_000), today).reserved).toBe(0)
    expect(budgetStatus(budget(300_000, true), clp(120_000), clp(30_000), today).reserved).toBe(150_000)
    expect(budgetStatus(budget(300_000, true), clp(350_000), clp(0), today).reserved).toBe(0)
    expect(budgetStatus(budget(300_000, false), clp(0), clp(0), today).reserved).toBe(0)
  })

  it('lista los presupuestos del mes y rechaza duplicados o montos negativos', () => {
    const spent = new Map([[cat('supermercado'), clp(90_000)]])
    const statuses = budgetStatuses(
      [budget(300_000), budget(420_000, true, 'arriendo'), { ...budget(1, false, 'ocio'), month: yearMonth('2026-10') }],
      november,
      spent,
      new Map(),
      today,
    )
    expect(statuses.map((status) => [status.categoryId, status.spent])).toEqual([
      ['arriendo', 0],
      ['supermercado', 90_000],
    ])
    expect(() => budgetStatuses([budget(1), budget(2)], november, spent, new Map(), today)).toThrow(DomainError)
    expect(() => budgetStatus(budget(-1), clp(0), clp(0), today)).toThrow(DomainError)
  })
})
