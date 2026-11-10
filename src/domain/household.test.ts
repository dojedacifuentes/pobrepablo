import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DomainError } from './errors'
import {
  expenseShares,
  householdBalances,
  memberShares,
  reconcile,
  suggestSettlements,
  validateSettlement,
  validateSharedExpense,
} from './household'
import { type MemberId, toId } from './ids'
import { ZERO, money, negate, sum } from './money'
import { equalShares, percentShares } from './split'
import { arbLargeHousehold, arbSettlements, arbSharedExpenses } from './testing/arbitraries'
import { DIEGO, MEMBERS, PABLO, d, settlement, sharedExpense } from './testing/builders'

const balancesOf = (...args: Parameters<typeof householdBalances>) => Object.fromEntries(householdBalances(...args))

describe('gastos compartidos del hogar', () => {
  const groceries = sharedExpense('s1', '2026-11-09', 200_000, DIEGO)

  it('caso canónico: Diego paga $200.000 de un gasto 50/50', () => {
    expect(expenseShares(groceries)).toEqual([
      { participantId: DIEGO, amount: 100_000 },
      { participantId: PABLO, amount: 100_000 },
    ])
    // Diego paid 200.000 and his part is 100.000: the household owes him 100.000.
    expect(balancesOf(MEMBERS, [groceries], [])).toEqual({ diego: 100_000, pablo: -100_000 })
    expect(memberShares(PABLO, [groceries])).toEqual([
      { sharedExpenseId: 's1', date: '2026-11-09', categoryId: 'supermercado', amount: 100_000 },
    ])
  })

  it('reparto 70/30', () => {
    const rent = sharedExpense(
      's2',
      '2026-11-05',
      420_000,
      PABLO,
      percentShares([
        { participantId: PABLO, basisPoints: 7000 },
        { participantId: DIEGO, basisPoints: 3000 },
      ]),
    )
    expect(balancesOf(MEMBERS, [rent], [])).toEqual({ diego: -126_000, pablo: 126_000 })
  })

  it('reembolso parcial y total', () => {
    const partial = settlement('st1', '2026-11-10', PABLO, DIEGO, 40_000)
    const rest = settlement('st2', '2026-11-12', PABLO, DIEGO, 60_000)
    expect(balancesOf(MEMBERS, [groceries], [partial])).toEqual({ diego: 60_000, pablo: -60_000 })
    expect(balancesOf(MEMBERS, [groceries], [partial, rest])).toEqual({ diego: 0, pablo: 0 })
    expect(balancesOf(MEMBERS, [groceries], [partial, rest], d('2026-11-11'))).toEqual({
      diego: 60_000,
      pablo: -60_000,
    })

    expect(reconcile([groceries], [])).toMatchObject([{ status: 'pending', settled: 0, amount: 100_000 }])
    expect(reconcile([groceries], [partial])).toMatchObject([{ status: 'partial', settled: 40_000 }])
    expect(reconcile([groceries], [partial, rest])).toMatchObject([{ status: 'settled', settled: 100_000 }])
  })

  it('lo que uno debe se compensa con lo que le deben', () => {
    const dinner = sharedExpense('s3', '2026-11-11', 60_000, PABLO)
    const partial = settlement('st1', '2026-11-10', PABLO, DIEGO, 40_000)
    expect(balancesOf(MEMBERS, [groceries, dinner], [partial])).toEqual({ diego: 30_000, pablo: -30_000 })

    const obligations = reconcile([groceries, dinner], [partial])
    expect(obligations).toMatchObject([
      { sharedExpenseId: 's1', debtorId: PABLO, creditorId: DIEGO, amount: 100_000, settled: 70_000, status: 'partial' },
      { sharedExpenseId: 's3', debtorId: DIEGO, creditorId: PABLO, amount: 30_000, settled: 30_000, status: 'settled' },
    ])
  })

  it('quien paga puede no participar del gasto', () => {
    const gift = sharedExpense('s4', '2026-11-09', 30_000, DIEGO, [{ participantId: PABLO, weight: 1 }])
    expect(balancesOf(MEMBERS, [gift], [])).toEqual({ diego: 30_000, pablo: -30_000 })
  })

  it('un gasto anulado deja de contar', () => {
    expect(balancesOf(MEMBERS, [{ ...groceries, voided: true }], [])).toEqual({ diego: 0, pablo: 0 })
    expect(reconcile([{ ...groceries, voided: true }], [])).toEqual([])
  })

  it('sugiere el pago que deja todo en cero', () => {
    expect(suggestSettlements([groceries], [])).toEqual([{ fromMemberId: PABLO, toMemberId: DIEGO, amount: 100_000 }])
    expect(suggestSettlements([], [])).toEqual([])
    expect(suggestSettlements([groceries], [settlement('st', '2026-11-10', PABLO, DIEGO, 100_000)])).toEqual([])
    // Paid back more than was owed: the excess is suggested back.
    expect(suggestSettlements([groceries], [settlement('st', '2026-11-10', PABLO, DIEGO, 130_000)])).toEqual([
      { fromMemberId: DIEGO, toMemberId: PABLO, amount: 30_000 },
    ])
  })

  it('con tres personas sugiere un pago por cada par, coherente con el estado de cada deuda', () => {
    const three: MemberId[] = [toId('a'), toId('b'), toId('c')]
    const trip = sharedExpense('s5', '2026-11-09', 90_000, toId('a'), equalShares(three))
    const taxi = sharedExpense('s6', '2026-11-09', 30_000, toId('b'), equalShares(three))
    const suggested = suggestSettlements([trip, taxi], [])
    expect(suggested).toEqual([
      { fromMemberId: 'b', toMemberId: 'a', amount: 20_000 },
      { fromMemberId: 'c', toMemberId: 'a', amount: 30_000 },
      { fromMemberId: 'c', toMemberId: 'b', amount: 10_000 },
    ])

    const payments = suggested.map((payment, index) =>
      settlement(`st-${String(index)}`, '2026-11-10', payment.fromMemberId, payment.toMemberId, payment.amount),
    )
    expect([...householdBalances(three, [trip, taxi], payments).values()]).toEqual([0, 0, 0])
    expect(reconcile([trip, taxi], payments).every((obligation) => obligation.status === 'settled')).toBe(true)
  })

  it('un mismo gasto o reembolso listado dos veces se rechaza en vez de contarse doble', () => {
    expect(() => householdBalances(MEMBERS, [groceries, groceries], [])).toThrow(DomainError)
    const repaid = settlement('st', '2026-11-10', PABLO, DIEGO, 100_000)
    expect(() => householdBalances(MEMBERS, [groceries], [repaid, repaid])).toThrow(DomainError)
  })

  it('rechaza datos que no cuadran con el hogar', () => {
    expect(() => {
      validateSharedExpense(sharedExpense('x', '2026-11-09', 0, DIEGO), MEMBERS)
    }).toThrow(DomainError)
    expect(() => {
      validateSharedExpense(sharedExpense('x', '2026-11-09', 100, toId('otro')), MEMBERS)
    }).toThrow(DomainError)
    expect(() => {
      validateSharedExpense(sharedExpense('x', '2026-11-09', 100, DIEGO, []), MEMBERS)
    }).toThrow(DomainError)
    expect(() => {
      validateSettlement(settlement('x', '2026-11-09', DIEGO, DIEGO, 100), MEMBERS)
    }).toThrow(DomainError)
    expect(() => householdBalances(MEMBERS, [sharedExpense('x', '2026-11-09', 100, toId('otro'))], [])).toThrow(
      DomainError,
    )
  })
})

describe('invariantes del hogar', () => {
  it('los saldos internos siempre suman cero', () => {
    fc.assert(
      fc.property(arbSharedExpenses, arbSettlements, (expenses, settlements) => {
        expect(sum(householdBalances(MEMBERS, expenses, settlements).values())).toBe(0)
      }),
    )
  })

  it('también con tres a cinco personas', () => {
    fc.assert(
      fc.property(arbLargeHousehold, ({ members, expenses, settlements }) => {
        expect(sum(householdBalances(members, expenses, settlements).values())).toBe(0)
      }),
    )
  })

  it('anular un gasto compartido o un reembolso equivale a que nunca hubiera existido', () => {
    fc.assert(
      fc.property(arbLargeHousehold, fc.nat(), ({ members, expenses, settlements }, pick) => {
        fc.pre(expenses.length > 0 && settlements.length > 0)
        const expenseIndex = pick % expenses.length
        const settlementIndex = pick % settlements.length
        const voidedExpenses = expenses.map((item, index) => (index === expenseIndex ? { ...item, voided: true } : item))
        const voidedSettlements = settlements.map((item, index) =>
          index === settlementIndex ? { ...item, voided: true } : item,
        )
        const withoutExpense = expenses.filter((_, index) => index !== expenseIndex)
        const withoutSettlement = settlements.filter((_, index) => index !== settlementIndex)

        expect(householdBalances(members, voidedExpenses, voidedSettlements)).toEqual(
          householdBalances(members, withoutExpense, withoutSettlement),
        )
        expect(reconcile(voidedExpenses, voidedSettlements)).toEqual(reconcile(withoutExpense, withoutSettlement))
      }),
    )
  })

  it('las partes de cada gasto suman el gasto', () => {
    fc.assert(
      fc.property(arbSharedExpenses, (expenses) => {
        for (const expense of expenses) {
          expect(sum(expenseShares(expense).map((share) => share.amount))).toBe(expense.total)
        }
      }),
    )
  })

  it('pagar lo sugerido deja todos los saldos en cero y todas las deudas saldadas, con cualquier número de personas', () => {
    fc.assert(
      fc.property(arbLargeHousehold, ({ members, expenses, settlements }) => {
        const payments = suggestSettlements(expenses, settlements).map((payment, index) => {
          expect(payment.amount).toBeGreaterThan(0)
          return settlement(
            `pago-${String(index)}`,
            '2027-01-01',
            payment.fromMemberId,
            payment.toMemberId,
            payment.amount,
          )
        })
        const all = [...settlements, ...payments]
        expect([...householdBalances(members, expenses, all).values()].every((balance) => balance === 0)).toBe(true)
        expect(reconcile(expenses, all).every((obligation) => obligation.status === 'settled')).toBe(true)
        expect(suggestSettlements(expenses, all)).toEqual([])
      }),
    )
  })

  it('lo que queda sin conciliar coincide con el saldo interno, salvo pagos adelantados', () => {
    fc.assert(
      fc.property(arbSharedExpenses, arbSettlements, (expenses, settlements) => {
        const obligations = reconcile(expenses, settlements)
        for (const obligation of obligations) {
          expect(obligation.settled).toBeGreaterThanOrEqual(0)
          expect(obligation.settled).toBeLessThanOrEqual(obligation.amount)
        }
        const outstanding = (debtor: MemberId) =>
          sum(obligations.filter((item) => item.debtorId === debtor).map((item) => money(item.amount - item.settled)))
        const pablo = householdBalances(MEMBERS, expenses, settlements).get(PABLO) ?? ZERO

        // Only one side can have something outstanding at a time.
        expect(outstanding(PABLO) === 0 || outstanding(DIEGO) === 0).toBe(true)
        // What is outstanding never exceeds what the balance says is owed.
        expect(outstanding(PABLO)).toBeLessThanOrEqual(Math.max(0, negate(pablo)))
        expect(outstanding(DIEGO)).toBeLessThanOrEqual(Math.max(0, pablo))
      }),
    )
  })
})
