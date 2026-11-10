import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { indexAccounts } from './accounts'
import { DomainError } from './errors'
import {
  householdLedgerIssues,
  recordSettlement,
  recordSharedExpense,
  voidSettlement,
  voidSharedExpense,
} from './household-ledger'
import { toId } from './ids'
import { type HouseholdView, type SnapshotInput, financialSnapshot } from './magnitudes'
import { arbSettlements, arbSharedExpenses } from './testing/arbitraries'
import {
  CHECKING,
  DIEGO,
  MEMBERS,
  PABLO,
  baseAccounts,
  d,
  settlement,
  settlementMove,
  sharedExpense,
  sharedPayment,
} from './testing/builders'
import type { Transaction } from './transactions'

const groceries = sharedExpense('s1', '2026-11-09', 200_000, DIEGO)
const repaid = settlement('st1', '2026-11-10', PABLO, DIEGO, 100_000)

describe('los dos lados de un registro del hogar viajan juntos', () => {
  it('quien pagó registra también la salida de dinero, por el total y el mismo día', () => {
    const { payment } = recordSharedExpense(groceries, DIEGO, { id: toId('p1'), accountId: CHECKING })
    expect(payment).toMatchObject({
      kind: 'shared_payment',
      date: '2026-11-09',
      amount: 200_000,
      accountId: CHECKING,
      sharedExpenseId: 's1',
    })
  })

  it('quien no pagó no mueve ninguna cuenta', () => {
    expect(recordSharedExpense(groceries, PABLO).payment).toBeNull()
    expect(() => recordSharedExpense(groceries, PABLO, { id: toId('p1'), accountId: CHECKING })).toThrow(DomainError)
    expect(() => recordSharedExpense(groceries, DIEGO)).toThrow(DomainError)
  })

  it('un reembolso crea el movimiento de quien paga y de quien recibe', () => {
    expect(recordSettlement(repaid, PABLO, { id: toId('m1'), accountId: CHECKING }).movement).toMatchObject({
      kind: 'settlement',
      direction: 'paid',
      amount: 100_000,
      date: '2026-11-10',
      settlementId: 'st1',
    })
    expect(recordSettlement(repaid, DIEGO, { id: toId('m2'), accountId: CHECKING }).movement).toMatchObject({
      direction: 'received',
    })
    expect(recordSettlement(repaid, toId('otro')).movement).toBeNull()
    expect(() => recordSettlement(repaid, PABLO)).toThrow(DomainError)
  })

  it('anular el gasto compartido anula también su pago', () => {
    const { payment } = recordSharedExpense(groceries, DIEGO, { id: toId('p1'), accountId: CHECKING })
    const unrelated = sharedPayment('p2', '2026-11-09', 5_000, CHECKING, 'otro')
    const transactions: Transaction[] = payment === null ? [unrelated] : [payment, unrelated]
    const voided = voidSharedExpense(groceries, transactions)
    expect(voided.expense.voided).toBe(true)
    expect(voided.transactions).toMatchObject([{ id: 'p1', voided: true }])

    const moved = recordSettlement(repaid, PABLO, { id: toId('m1'), accountId: CHECKING }).movement
    expect(voidSettlement(repaid, moved === null ? [] : [moved]).transactions).toMatchObject([
      { id: 'm1', voided: true },
    ])
  })
})

describe('anular un registro del hogar devuelve todas las magnitudes al valor previo', () => {
  const base: SnapshotInput = {
    accounts: baseAccounts({ checking: 500_000 }),
    transactions: [],
    rules: [],
    cancelledOccurrences: [],
    budgets: [],
    goals: [],
    reservations: [],
    household: { memberId: DIEGO, members: MEMBERS, expenses: [], settlements: [] },
    today: d('2026-11-10'),
  }
  const withHousehold = (
    transactions: Transaction[],
    expenses: HouseholdView['expenses'],
    settlements: HouseholdView['settlements'] = [],
  ): SnapshotInput => ({
    ...base,
    transactions,
    household: { memberId: DIEGO, members: MEMBERS, expenses, settlements },
  })

  it('registrar y anular los dos lados deja todo como estaba', () => {
    const before = financialSnapshot(base)
    const { expense, payment } = recordSharedExpense(groceries, DIEGO, { id: toId('p1'), accountId: CHECKING })
    const transactions: Transaction[] = payment === null ? [] : [payment]

    const during = financialSnapshot(withHousehold(transactions, [expense]))
    expect(during.liquidBalance).toBe(300_000)
    expect(during.netWorth.net).toBe(400_000)

    const voided = voidSharedExpense(expense, transactions)
    const after = financialSnapshot(withHousehold(voided.transactions, [voided.expense]))
    expect(after.netWorth).toEqual(before.netWorth)
    expect(after.totals).toEqual(before.totals)
    expect(after.available).toEqual(before.available)
  })

  it('anular un solo lado descuadra las cuentas, y la revisión lo detecta', () => {
    const { expense, payment } = recordSharedExpense(groceries, DIEGO, { id: toId('p1'), accountId: CHECKING })
    const transactions: Transaction[] = payment === null ? [] : [payment]

    // Only the household event is voided: 200.000 left the account with no explanation.
    const onlyExpense = [{ ...expense, voided: true }]
    expect(financialSnapshot(withHousehold(transactions, onlyExpense)).netWorth.net).toBe(300_000)
    expect(householdLedgerIssues(DIEGO, transactions, onlyExpense, [])).toMatchObject([
      { kind: 'payment_without_expense', transactionId: 'p1', sharedExpenseId: 's1' },
    ])

    // Only the cash movement is voided: 100.000 appear from nowhere.
    const onlyPayment = transactions.map((transaction) => ({ ...transaction, voided: true }))
    expect(financialSnapshot(withHousehold(onlyPayment, [expense])).netWorth.net).toBe(600_000)
    expect(householdLedgerIssues(DIEGO, onlyPayment, [expense], [])).toEqual([
      { kind: 'expense_without_payment', sharedExpenseId: 's1' },
    ])
  })
})

describe('revisión de coherencia del hogar', () => {
  const paid = sharedPayment('p1', '2026-11-09', 200_000, CHECKING, 's1')
  const kinds = (...args: Parameters<typeof householdLedgerIssues>) =>
    householdLedgerIssues(...args).map((issue) => issue.kind)

  it('no encuentra nada cuando los dos lados cuentan la misma historia', () => {
    expect(householdLedgerIssues(DIEGO, [paid], [groceries], [])).toEqual([])
    expect(householdLedgerIssues(PABLO, [], [groceries], [])).toEqual([])
    expect(
      householdLedgerIssues(PABLO, [settlementMove('m1', '2026-11-10', 100_000, CHECKING, 'paid', 'st1')], [groceries], [
        repaid,
      ]),
    ).toEqual([])
  })

  it('detecta cada forma en que un par se puede separar', () => {
    expect(kinds(DIEGO, [paid], [], [])).toEqual(['payment_without_expense'])
    expect(kinds(PABLO, [paid], [groceries], [])).toEqual(['payment_by_non_payer'])
    expect(kinds(DIEGO, [{ ...paid, amount: paid.amount }, sharedPayment('p2', '2026-11-09', 200_000, CHECKING, 's1')], [groceries], [])).toEqual([
      'duplicate_payment',
    ])
    expect(kinds(DIEGO, [sharedPayment('p1', '2026-11-09', 180_000, CHECKING, 's1')], [groceries], [])).toEqual([
      'payment_mismatch',
    ])
    expect(kinds(DIEGO, [sharedPayment('p1', '2026-11-08', 200_000, CHECKING, 's1')], [groceries], [])).toEqual([
      'payment_mismatch',
    ])
    expect(kinds(DIEGO, [], [groceries], [])).toEqual(['expense_without_payment'])

    const received = settlementMove('m1', '2026-11-10', 100_000, CHECKING, 'received', 'st1')
    expect(kinds(DIEGO, [paid, received], [groceries], [])).toEqual(['movement_without_settlement'])
    expect(kinds(PABLO, [received], [groceries], [repaid])).toEqual(['movement_mismatch'])
    expect(kinds(DIEGO, [paid, received, { ...received, id: toId('m2') }], [groceries], [repaid])).toEqual([
      'duplicate_movement',
    ])
    expect(kinds(DIEGO, [paid], [groceries], [repaid])).toEqual(['settlement_without_movement'])
  })

  it('no pide movimientos de lo anterior al día en que la persona empezó a registrar', () => {
    const old = sharedExpense('viejo', '2026-05-09', 60_000, DIEGO)
    const oldRepaid = settlement('st-viejo', '2026-05-10', PABLO, DIEGO, 30_000)
    expect(kinds(DIEGO, [], [old], [oldRepaid])).toEqual(['expense_without_payment', 'settlement_without_movement'])
    expect(householdLedgerIssues(DIEGO, [], [old], [oldRepaid], d('2026-06-01'))).toEqual([])
    // What is dated from that day on is still expected.
    expect(householdLedgerIssues(DIEGO, [], [old, groceries], [], d('2026-06-01'))).toEqual([
      { kind: 'expense_without_payment', sharedExpenseId: 's1' },
    ])
  })

  it('con el contexto a la vista, el pago se valida como cualquier movimiento', () => {
    const context = { accounts: indexAccounts(baseAccounts()), today: d('2026-11-10') }
    const payment = { id: toId<'transaction'>('p1'), accountId: CHECKING }
    expect(() => recordSharedExpense(groceries, DIEGO, payment, context)).not.toThrow()
    // Paid before the account's opening balance, or dated in the future: rejected.
    expect(() => recordSharedExpense(sharedExpense('x', '2025-12-01', 60_000, DIEGO), DIEGO, payment, context)).toThrow(
      DomainError,
    )
    expect(() => recordSharedExpense(sharedExpense('x', '2026-11-11', 60_000, DIEGO), DIEGO, payment, context)).toThrow(
      DomainError,
    )
  })

  it('lo que se registra con las funciones del hogar siempre queda coherente, también tras anular', () => {
    fc.assert(
      fc.property(arbSharedExpenses, arbSettlements, fc.nat(), (expenses, settlements, pick) => {
        const transactions: Transaction[] = []
        for (const expense of expenses) {
          const { payment } = recordSharedExpense(
            expense,
            DIEGO,
            expense.payerId === DIEGO ? { id: toId(`pay-${expense.id}`), accountId: CHECKING } : undefined,
          )
          if (payment !== null) {
            transactions.push({ ...payment, voided: expense.voided })
          }
        }
        for (const item of settlements) {
          const { movement } = recordSettlement(item, DIEGO, { id: toId(`move-${item.id}`), accountId: CHECKING })
          if (movement !== null) {
            transactions.push({ ...movement, voided: item.voided })
          }
        }
        expect(householdLedgerIssues(DIEGO, transactions, expenses, settlements)).toEqual([])

        const target = expenses[pick % Math.max(1, expenses.length)]
        if (target === undefined) {
          return
        }
        const voided = voidSharedExpense(target, transactions)
        const changed = new Map(voided.transactions.map((transaction) => [transaction.id, transaction]))
        expect(
          householdLedgerIssues(
            DIEGO,
            transactions.map((transaction) => changed.get(transaction.id) ?? transaction),
            expenses.map((expense) => (expense.id === target.id ? voided.expense : expense)),
            settlements,
          ),
        ).toEqual([])
      }),
    )
  })
})
