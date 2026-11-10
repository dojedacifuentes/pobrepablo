import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { type Account, indexAccounts } from './accounts'
import {
  accountBalance,
  applyTransaction,
  balancesFromHistory,
  liquidBalance,
  openingBalances,
  revertTransaction,
  totalRegisteredBalance,
} from './balances'
import { DEFAULT_CATEGORIES } from './categories'
import type { LocalDate } from './dates'
import { DomainError } from './errors'
import { toId } from './ids'
import { ASSET_ACCOUNTS, arbAccountPair, arbAmount, arbDate, arbLedger } from './testing/arbitraries'
import {
  CARD,
  CASH,
  CHECKING,
  SAVINGS,
  adjustment,
  baseAccounts,
  cat,
  clp,
  d,
  expense,
  income,
  transfer,
} from './testing/builders'
import { type Transaction, validateTransaction, voidTransaction } from './transactions'

const today = d('2026-11-10')

describe('saldos', () => {
  const accounts = baseAccounts({ checking: 500_000, cash: 20_000 })

  it('un ingreso sube el saldo y un gasto lo baja', () => {
    const balances = balancesFromHistory(accounts, [
      income('i1', '2026-11-02', 1_000_000),
      expense('e1', '2026-11-03', 35_990),
      expense('e2', '2026-11-04', 5000, CASH),
    ])
    expect(accountBalance(balances, CHECKING)).toBe(1_464_010)
    expect(accountBalance(balances, CASH)).toBe(15_000)
  })

  it('una transferencia mueve el dinero sin crearlo ni destruirlo', () => {
    const before = balancesFromHistory(accounts, [])
    const after = balancesFromHistory(accounts, [transfer('t1', '2026-11-05', 200_000, CHECKING, SAVINGS)])
    expect(accountBalance(after, CHECKING)).toBe(300_000)
    expect(accountBalance(after, SAVINGS)).toBe(200_000)
    expect(totalRegisteredBalance(accounts, after)).toBe(totalRegisteredBalance(accounts, before))
    expect(liquidBalance(accounts, after)).toBe(320_000)
  })

  it('un movimiento anulado no cuenta', () => {
    const spent = expense('e1', '2026-11-03', 35_990)
    expect(accountBalance(balancesFromHistory(accounts, [voidTransaction(spent)]), CHECKING)).toBe(500_000)
  })

  it('un movimiento con fecha posterior a hoy no entra en el saldo confirmado', () => {
    const history = [expense('e1', '2026-11-03', 10_000), expense('e2', '2026-11-20', 40_000)]
    expect(accountBalance(balancesFromHistory(accounts, history, today), CHECKING)).toBe(490_000)
    expect(accountBalance(balancesFromHistory(accounts, history), CHECKING)).toBe(450_000)
  })

  it('un ajuste corrige el saldo en cualquier sentido', () => {
    const balances = balancesFromHistory(accounts, [
      adjustment('a1', '2026-11-03', -1500, CASH),
      adjustment('a2', '2026-11-03', 700, CHECKING),
    ])
    expect(accountBalance(balances, CASH)).toBe(18_500)
    expect(accountBalance(balances, CHECKING)).toBe(500_700)
  })

  it('en honorarios solo cuenta el líquido recibido', () => {
    const fee = income('i1', '2026-11-02', 847_500, CHECKING, {
      honorarium: { gross: clp(1_000_000), withholding: clp(152_500) },
    })
    validateTransaction(fee, { accounts: indexAccounts(accounts), today })
    expect(accountBalance(balancesFromHistory(accounts, [fee]), CHECKING)).toBe(1_347_500)
  })

  it('rechaza una cuenta que no existe', () => {
    const balances = openingBalances(accounts)
    expect(() => applyTransaction(balances, expense('e1', '2026-11-03', 1, toId('nope')))).toThrow(DomainError)
    expect(() => accountBalance(balances, toId('nope'))).toThrow(DomainError)
  })
})

describe('validación de movimientos', () => {
  const context = { accounts: indexAccounts(baseAccounts()), today }
  const rejects = (transaction: Transaction, extra = {}) => {
    expect(() => {
      validateTransaction(transaction, { ...context, ...extra })
    }).toThrow(DomainError)
  }
  const accepts = (transaction: Transaction, extra = {}) => {
    expect(() => {
      validateTransaction(transaction, { ...context, ...extra })
    }).not.toThrow()
  }

  it('acepta movimientos bien formados', () => {
    accepts(expense('e1', '2026-11-03', 1000))
    accepts(expense('e2', '2026-11-10', 1000))
    accepts(expense('e3', '2026-11-03', 90_000, CARD, { installments: { count: 3, firstDueDate: d('2026-12-05') } }))
    accepts(transfer('t1', '2026-11-03', 1000, CHECKING, SAVINGS, { goalId: toId('viaje') }))
  })

  it('rechaza lo que rompe una regla contable', () => {
    rejects(expense('e1', '2026-11-03', 0))
    rejects(adjustment('a1', '2026-11-03', 0, CASH))
    rejects(transfer('t1', '2026-11-03', 1000, CASH, CASH))
    rejects(expense('e2', '2026-11-03', 1000, CHECKING, { installments: { count: 3, firstDueDate: d('2026-12-05') } }))
    rejects(expense('e3', '2026-11-03', 1000, CARD, { installments: { count: 0, firstDueDate: d('2026-12-05') } }))
    rejects(expense('e4', '2026-11-03', 1000, CARD, { installments: { count: 2, firstDueDate: d('2026-11-01') } }))
    rejects(income('i1', '2026-11-03', 900_000, CHECKING, { honorarium: { gross: clp(1_000_000), withholding: clp(50_000) } }))
    rejects(expense('e5', '2025-12-31', 1000))
    rejects(expense('e6', '2026-11-03', 1000, toId('nope')))
  })

  it('no acepta movimientos con fecha futura: lo que viene se programa', () => {
    rejects(expense('e1', '2026-11-11', 1000))
    rejects(income('i1', '2026-12-01', 1_000_000))
  })

  it('no acepta más cuotas que pesos', () => {
    rejects(expense('e1', '2026-11-03', 2, CARD, { installments: { count: 3, firstDueDate: d('2026-12-05') } }))
    accepts(expense('e2', '2026-11-03', 3, CARD, { installments: { count: 3, firstDueDate: d('2026-12-05') } }))
  })

  it('un aporte a una meta toca exactamente una cuenta de ahorro', () => {
    rejects(transfer('t1', '2026-11-03', 1000, CASH, CHECKING, { goalId: toId('viaje') }))
    rejects(transfer('t2', '2026-11-03', 1000, CHECKING, CARD, { goalId: toId('viaje') }))
    accepts(transfer('t3', '2026-11-03', 1000, SAVINGS, CHECKING, { goalId: toId('viaje') }))
  })

  it('con las categorías a la vista, un gasto no puede usar una categoría de ingreso', () => {
    const categories = new Map(DEFAULT_CATEGORIES.map((category) => [category.id, category]))
    accepts(expense('e1', '2026-11-03', 1000), { categories })
    accepts(income('i1', '2026-11-03', 1000), { categories })
    rejects(expense('e2', '2026-11-03', 1000, CHECKING, { categoryId: cat('sueldo') }), { categories })
    rejects(income('i2', '2026-11-03', 1000, CHECKING, { categoryId: cat('supermercado') }), { categories })
    rejects(expense('e3', '2026-11-03', 1000, CHECKING, { categoryId: cat('no-existe') }), { categories })
  })
})

/**
 * An independent calculation of the balances, written out kind by kind with plain numbers. It
 * shares no code with the domain: if the domain got a sign wrong, this would disagree.
 */
function expectedBalances(accounts: readonly Account[], transactions: readonly Transaction[], asOf?: LocalDate) {
  const result: Record<string, number> = {}
  for (const account of accounts) {
    result[account.id] = asOf === undefined || account.openingDate <= asOf ? account.openingBalance : 0
  }
  const bump = (accountId: string, delta: number) => {
    result[accountId] = (result[accountId] ?? 0) + delta
  }
  for (const transaction of transactions) {
    if (transaction.voided || (asOf !== undefined && transaction.date > asOf)) {
      continue
    }
    switch (transaction.kind) {
      case 'income':
        bump(transaction.accountId, transaction.amount)
        break
      case 'expense':
      case 'shared_payment':
        bump(transaction.accountId, -1 * transaction.amount)
        break
      case 'transfer':
        bump(transaction.fromAccountId, -1 * transaction.amount)
        bump(transaction.toAccountId, transaction.amount)
        break
      case 'settlement':
        bump(transaction.accountId, transaction.direction === 'paid' ? -1 * transaction.amount : transaction.amount)
        break
      case 'adjustment':
        bump(transaction.accountId, transaction.amount)
        break
    }
  }
  return result
}

describe('invariantes de saldos', () => {
  it('saldos incrementales, recalculados desde el historial y calculados aparte coinciden', () => {
    fc.assert(
      fc.property(arbLedger, ({ accounts, transactions }) => {
        let incremental = openingBalances(accounts)
        for (const transaction of transactions) {
          incremental = applyTransaction(incremental, transaction)
        }
        const recomputed = balancesFromHistory(accounts, transactions)
        expect(incremental).toEqual(recomputed)
        expect(Object.fromEntries(recomputed)).toEqual(expectedBalances(accounts, transactions))
      }),
    )
  })

  it('el saldo a una fecha coincide con el cálculo aparte y no depende del orden del historial', () => {
    fc.assert(
      fc.property(arbLedger, arbDate('2026-01-01', '2026-12-28'), ({ accounts, transactions }, asOf) => {
        const expected = expectedBalances(accounts, transactions, asOf)
        expect(Object.fromEntries(balancesFromHistory(accounts, transactions, asOf))).toEqual(expected)
        expect(Object.fromEntries(balancesFromHistory(accounts, transactions.toReversed(), asOf))).toEqual(expected)
      }),
    )
  })

  it('aplicar y revertir un movimiento deja los saldos como estaban', () => {
    fc.assert(
      fc.property(arbLedger, ({ accounts, transactions }) => {
        const start = openingBalances(accounts)
        for (const transaction of transactions) {
          expect(revertTransaction(applyTransaction(start, transaction), transaction)).toEqual(start)
        }
      }),
    )
  })

  it('anular un movimiento equivale a que nunca hubiera existido', () => {
    fc.assert(
      fc.property(arbLedger, fc.nat(), ({ accounts, transactions }, pick) => {
        fc.pre(transactions.length > 0)
        const index = pick % transactions.length
        const voided = transactions.map((transaction, position) =>
          position === index ? voidTransaction(transaction) : transaction,
        )
        const removed = transactions.filter((_, position) => position !== index)
        expect(balancesFromHistory(accounts, voided)).toEqual(balancesFromHistory(accounts, removed))
      }),
    )
  })

  it('una transferencia entre cuentas propias no altera el saldo total registrado', () => {
    fc.assert(
      fc.property(
        arbLedger,
        arbAccountPair(ASSET_ACCOUNTS),
        arbAmount(),
        arbDate(),
        ({ accounts, transactions }, [from, to], amount, date) => {
          const before = balancesFromHistory(accounts, transactions)
          const after = applyTransaction(before, { ...transfer('extra', date, 1, from, to), amount })
          expect(totalRegisteredBalance(accounts, after)).toBe(totalRegisteredBalance(accounts, before))
        },
      ),
    )
  })
})
