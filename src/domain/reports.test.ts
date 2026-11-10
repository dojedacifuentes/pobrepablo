import { describe, expect, it } from 'vitest'
import { monthPeriod, yearMonth } from './dates'
import { toId } from './ids'
import { periodTotals } from './reports'
import {
  CARD,
  CHECKING,
  SAVINGS,
  adjustment,
  cat,
  clp,
  d,
  expense,
  income,
  settlementMove,
  sharedPayment,
  transfer,
} from './testing/builders'
import { voidTransaction } from './transactions'

const november = monthPeriod(yearMonth('2026-11'))

describe('ingresos y gastos del período', () => {
  it('suma por categoría', () => {
    const totals = periodTotals(
      [
        income('i1', '2026-11-02', 1_200_000),
        income('i2', '2026-11-10', 300_000, CHECKING, { categoryId: cat('honorarios') }),
        expense('e1', '2026-11-03', 45_000),
        expense('e2', '2026-11-15', 15_000),
        expense('e3', '2026-11-05', 420_000, CHECKING, { categoryId: cat('arriendo') }),
      ],
      november,
    )
    expect(totals.income).toBe(1_500_000)
    expect(totals.expense).toBe(480_000)
    expect(totals.net).toBe(1_020_000)
    expect(totals.expenseByCategory.get(cat('supermercado'))).toBe(60_000)
    expect(totals.expenseByCategory.get(cat('arriendo'))).toBe(420_000)
    expect(totals.incomeByCategory.get(cat('honorarios'))).toBe(300_000)
  })

  it('solo cuenta lo que cae dentro del período y no está anulado', () => {
    const totals = periodTotals(
      [
        expense('e1', '2026-10-31', 10_000),
        expense('e2', '2026-11-01', 20_000),
        expense('e3', '2026-11-30', 30_000),
        expense('e4', '2026-12-01', 40_000),
        voidTransaction(expense('e5', '2026-11-12', 99_000)),
      ],
      november,
    )
    expect(totals.expense).toBe(50_000)
  })

  it('transferir a la cuenta de ahorro no infla el gasto del mes', () => {
    const totals = periodTotals([transfer('t1', '2026-11-05', 200_000, CHECKING, SAVINGS)], november)
    expect(totals.expense).toBe(0)
    expect(totals.income).toBe(0)
  })

  it('la compra con tarjeta es el gasto; pagar la tarjeta no es un segundo gasto', () => {
    const totals = periodTotals(
      [expense('e1', '2026-11-03', 80_000, CARD), transfer('t1', '2026-11-20', 80_000, CHECKING, CARD)],
      november,
    )
    expect(totals.expense).toBe(80_000)
  })

  it('los intereses y comisiones de la tarjeta sí son gasto', () => {
    const totals = periodTotals(
      [expense('e1', '2026-11-25', 4_300, CARD, { categoryId: cat('deudas') })],
      november,
    )
    expect(totals.expense).toBe(4_300)
    expect(totals.expenseByCategory.get(cat('deudas'))).toBe(4_300)
  })

  it('en un gasto compartido cuenta la parte propia, no lo que se pagó por el hogar', () => {
    const totals = periodTotals(
      [sharedPayment('p1', '2026-11-09', 200_000, CHECKING, 's1')],
      november,
      [{ sharedExpenseId: toId('s1'), date: d('2026-11-09'), categoryId: cat('supermercado'), amount: clp(100_000) }],
    )
    expect(totals.expense).toBe(100_000)
    expect(totals.expenseByCategory.get(cat('supermercado'))).toBe(100_000)
  })

  it('un reembolso no es ingreso ni gasto, y un ajuste tampoco', () => {
    const totals = periodTotals(
      [
        settlementMove('m1', '2026-11-10', 100_000, CHECKING, 'received', 'st1'),
        settlementMove('m2', '2026-11-11', 30_000, CHECKING, 'paid', 'st2'),
        adjustment('a1', '2026-11-12', -2_000, CHECKING),
      ],
      november,
    )
    expect(totals.income).toBe(0)
    expect(totals.expense).toBe(0)
  })
})
