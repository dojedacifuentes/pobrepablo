import { describe, expect, it } from 'vitest'
import {
  type AccountId,
  type RuleId,
  accountBalance,
  balancesFromHistory,
  equalShares,
  financialSnapshot,
  householdBalances,
  toId,
} from '@/domain'
import { DIEGO, MEMBERS, PABLO, cat, clp, d } from '@/domain/testing/builders'
import { type ProfileStore, toSnapshotInput } from '../ports'
import type { ProfileId } from '../records'
import { failureOf, testPhone } from '../testing/harness'

const CHECKING: AccountId = toId('corriente')
const CARD: AccountId = toId('tarjeta')

/** A profile that started registering on 1 October 2026, with a current account and a card. */
async function prepared(profile: ProfileId = 'diego') {
  const phone = testPhone('2026-11-10')
  const session = await phone.open(profile)
  const { store } = session
  await store.createAccount({
    id: CHECKING,
    name: 'Cuenta de prueba',
    kind: 'checking',
    openingBalance: clp(1_000_000),
    openingDate: d('2026-10-01'),
  })
  await store.createAccount({
    id: CARD,
    name: 'Tarjeta de prueba',
    kind: 'credit_card',
    openingBalance: clp(0),
    openingDate: d('2026-10-01'),
    paymentDay: 5,
  })
  return { phone, session, store }
}

const rent = (payerId = DIEGO, extra: object = {}) => ({
  date: d('2026-11-05'),
  description: 'Arriendo de prueba',
  categoryId: cat('arriendo'),
  total: clp(200_000),
  payerId,
  shares: equalShares(MEMBERS),
  ...extra,
})

async function counts(store: ProfileStore) {
  const ledger = await store.ledger()
  return {
    expenses: ledger.sharedExpenses.length,
    settlements: ledger.settlements.length,
    transactions: ledger.transactions.length,
    audit: (await store.audit()).length,
  }
}

describe('gasto compartido: los dos lados en la misma operación', () => {
  it('caso de referencia: Diego paga $200.000 a medias', async () => {
    const { store } = await prepared('diego')
    const { sharedExpenseId, transactionId } = await store.recordSharedExpense({
      ...rent(),
      payment: { accountId: CHECKING },
    })

    const ledger = await store.ledger()
    expect(ledger.sharedExpenses).toMatchObject([{ id: sharedExpenseId, total: 200_000, payerId: 'diego', authorId: 'diego' }])
    expect(ledger.transactions).toMatchObject([
      { id: transactionId, kind: 'shared_payment', amount: 200_000, date: '2026-11-05', sharedExpenseId },
    ])
    // One operation, one audit entry, with both rows in it.
    const [entry] = await store.audit({ last: 1 })
    expect(entry?.operation).toBe('shared_expense.create')
    expect(entry?.changes.map((change) => change.table)).toEqual(['sharedExpenses', 'transactions'])

    const balances = householdBalances(MEMBERS, ledger.sharedExpenses, ledger.settlements)
    expect(balances.get(DIEGO)).toBe(100_000)
    expect(balances.get(PABLO)).toBe(-100_000)
    expect(accountBalance(balancesFromHistory(ledger.accounts, ledger.transactions), CHECKING)).toBe(800_000)
    expect(await store.ledgerIssues()).toEqual([])
  })

  it('en el teléfono de quien no pagó solo aparece la deuda: ninguna cuenta se mueve', async () => {
    const { store } = await prepared('pablo')
    const { transactionId } = await store.recordSharedExpense(rent(DIEGO))
    expect(transactionId).toBeNull()
    expect(await store.transactions()).toEqual([])

    const snapshot = financialSnapshot(toSnapshotInput(await store.ledger(), d('2026-11-10')))
    expect(snapshot.householdBalance).toBe(-100_000)
    expect(await store.ledgerIssues()).toEqual([])

    await expect(store.recordSharedExpense({ ...rent(DIEGO), payment: { accountId: CHECKING } })).rejects.toThrow(
      'Solo quien pagó',
    )
    // Not even a debt can be dated in the future.
    expect(await failureOf(store.recordSharedExpense(rent(DIEGO, { date: d('2026-11-11') })))).toMatchObject({
      code: 'invalid_input',
    })
    expect(
      await failureOf(
        store.recordSettlement({ date: d('2026-11-11'), fromMemberId: toId('diego'), toMemberId: toId('vecino'), amount: clp(1) }),
      ),
    ).toBeInstanceOf(Error)
    expect((await store.ledger()).sharedExpenses).toHaveLength(1)
  })

  it('quien pagó debe decir de qué cuenta salió la plata; si no, no se guarda ninguno de los dos lados', async () => {
    const { store } = await prepared('diego')
    const before = await counts(store)
    await expect(store.recordSharedExpense(rent())).rejects.toThrow('de qué cuenta salió')
    await expect(
      store.recordSharedExpense({ ...rent(), payment: { accountId: toId('no-existe') } }),
    ).rejects.toThrow('La cuenta no existe')
    // The cash movement is invalid (the account did not exist yet that day): the expense must not stay.
    const recent: AccountId = toId('reciente')
    await store.createAccount({
      id: recent,
      name: 'Cuenta abierta después',
      kind: 'checking',
      openingBalance: clp(0),
      openingDate: d('2026-11-01'),
    })
    await expect(
      store.recordSharedExpense({ ...rent(DIEGO, { date: d('2026-10-20') }), payment: { accountId: recent } }),
    ).rejects.toThrow('anterior al saldo inicial')
    await expect(
      store.recordSharedExpense({ ...rent(DIEGO, { date: d('2026-11-11') }), payment: { accountId: CHECKING } }),
    ).rejects.toThrow('fecha futura')
    const after = await counts(store)
    // Only the new account was stored.
    expect(after).toEqual({ ...before, audit: before.audit + 1 })
  })

  it('lo anterior al día en que la persona empezó a registrar no exige movimiento', async () => {
    const { store } = await prepared('diego')
    const { transactionId } = await store.recordSharedExpense(rent(DIEGO, { date: d('2026-09-05') }))
    expect(transactionId).toBeNull()
    expect(await store.ledgerIssues()).toEqual([])
  })

  it('con tarjeta, el pago nace con su cuota; en cuenta corriente no hay cuotas', async () => {
    const { store } = await prepared('diego')
    await store.recordSharedExpense({ ...rent(), payment: { accountId: CARD, installments: 3 } })
    expect((await store.transactions())[0]).toMatchObject({
      kind: 'shared_payment',
      installments: { count: 3, firstDueDate: '2026-12-05' },
    })
    expect(
      await failureOf(store.recordSharedExpense({ ...rent(), payment: { accountId: CHECKING, installments: 3 } })),
    ).toMatchObject({ code: 'invalid_input' })
  })

  it('anular el gasto compartido anula también su pago, en una operación', async () => {
    const { store } = await prepared('diego')
    const { sharedExpenseId } = await store.recordSharedExpense({ ...rent(), payment: { accountId: CHECKING } })
    await store.voidSharedExpense(sharedExpenseId)

    const ledger = await store.ledger()
    expect(ledger.sharedExpenses[0]?.voided).toBe(true)
    expect(ledger.transactions[0]?.voided).toBe(true)
    expect(accountBalance(balancesFromHistory(ledger.accounts, ledger.transactions), CHECKING)).toBe(1_000_000)
    const [entry] = await store.audit({ last: 1 })
    expect(entry?.changes.map((change) => [change.table, change.action])).toEqual([
      ['sharedExpenses', 'void'],
      ['transactions', 'void'],
    ])
    expect(await store.ledgerIssues()).toEqual([])
  })

  it('anular solo la salida de dinero se rechaza: dejaría el gasto sin su pago', async () => {
    const { store } = await prepared('diego')
    const { transactionId } = await store.recordSharedExpense({ ...rent(), payment: { accountId: CHECKING } })
    if (transactionId === null) {
      throw new Error('se esperaba un pago')
    }
    const failure = await failureOf(store.voidTransaction(transactionId))
    expect(failure).toMatchObject({ code: 'ledger_mismatch' })
    expect((failure as { problems: string[] }).problems).toEqual([
      'Falta la salida de dinero de un gasto compartido que pagaste.',
    ])
    expect((await store.transactions())[0]?.voided).toBe(false)
    expect(await failureOf(store.editTransaction(transactionId, { kind: 'adjustment', date: d('2026-11-05'), amount: clp(1), accountId: CHECKING }))).toMatchObject({
      code: 'linked_record',
    })
  })

  it('un reparto inválido o un miembro desconocido se rechazan', async () => {
    const { store } = await prepared('diego')
    await expect(
      store.recordSharedExpense({ ...rent(), shares: [{ participantId: DIEGO, weight: 0 }], payment: { accountId: CHECKING } }),
    ).rejects.toThrow()
    await expect(
      store.recordSharedExpense({ ...rent(toId('vecino')), payment: { accountId: CHECKING } }),
    ).rejects.toThrow('no es miembro')
    await expect(
      store.recordSharedExpense({ ...rent(DIEGO, { categoryId: cat('sueldo') }), payment: { accountId: CHECKING } }),
    ).rejects.toThrow('categoría de ingreso')
    expect(await store.sharedExpenses()).toEqual([])
  })
})

describe('reembolso: los dos lados en la misma operación', () => {
  it('Pablo le devuelve a Diego: en cada teléfono, el reembolso y su movimiento', async () => {
    const pablo = await prepared('pablo')
    await pablo.store.recordSharedExpense(rent(DIEGO))
    const paid = await pablo.store.recordSettlement({
      date: d('2026-11-08'),
      fromMemberId: PABLO,
      toMemberId: DIEGO,
      amount: clp(100_000),
      movement: { accountId: CHECKING },
    })
    expect((await pablo.store.transactions())[0]).toMatchObject({
      id: paid.transactionId,
      kind: 'settlement',
      direction: 'paid',
      amount: 100_000,
    })
    expect(financialSnapshot(toSnapshotInput(await pablo.store.ledger(), d('2026-11-10'))).householdBalance).toBe(0)
    expect(await pablo.store.ledgerIssues()).toEqual([])

    const diego = await prepared('diego')
    await diego.store.recordSettlement({
      date: d('2026-11-08'),
      fromMemberId: PABLO,
      toMemberId: DIEGO,
      amount: clp(100_000),
      movement: { accountId: CHECKING },
    })
    expect((await diego.store.transactions())[0]).toMatchObject({ kind: 'settlement', direction: 'received' })
  })

  it('sin la cuenta por la que pasó la plata no se guarda nada; anular anula los dos lados', async () => {
    const { store } = await prepared('pablo')
    const before = await counts(store)
    const settlement = { date: d('2026-11-08'), fromMemberId: PABLO, toMemberId: DIEGO, amount: clp(50_000) }
    await expect(store.recordSettlement(settlement)).rejects.toThrow('Falta indicar la cuenta')
    await expect(store.recordSettlement({ ...settlement, toMemberId: PABLO, movement: { accountId: CHECKING } })).rejects.toThrow(
      'dos personas distintas',
    )
    expect(await counts(store)).toEqual(before)

    const { settlementId, transactionId } = await store.recordSettlement({ ...settlement, movement: { accountId: CHECKING } })
    if (transactionId === null) {
      throw new Error('se esperaba un movimiento')
    }
    expect(await failureOf(store.voidTransaction(transactionId))).toMatchObject({ code: 'ledger_mismatch' })
    await store.voidSettlement(settlementId)
    const ledger = await store.ledger()
    expect(ledger.settlements[0]?.voided).toBe(true)
    expect(ledger.transactions[0]?.voided).toBe(true)
    expect(await store.ledgerIssues()).toEqual([])
  })
})

describe('un recurrente que además es gasto compartido', () => {
  const RENT: RuleId = toId('arriendo')

  async function withRentRule(profile: ProfileId) {
    const context = await prepared(profile)
    await context.store.createRule({
      id: RENT,
      kind: 'expense',
      label: 'Arriendo de prueba',
      amount: clp(400_000),
      amountIsEstimate: false,
      accountId: CHECKING,
      categoryId: cat('arriendo'),
      frequency: 'monthly',
      interval: 1,
      startDate: d('2026-10-05'),
    })
    return context
  }

  it('quien paga confirma su regla y el gasto compartido se registra en la misma operación', async () => {
    const { store } = await withRentRule('diego')
    const { transactionId, sharedExpenseId } = await store.confirmOccurrence({
      ref: { ruleId: RENT, dueDate: d('2026-11-05') },
      date: d('2026-11-05'),
      shared: { description: 'Arriendo de noviembre (prueba)', shares: equalShares(MEMBERS) },
    })

    const ledger = await store.ledger()
    expect(ledger.transactions).toMatchObject([
      { id: transactionId, kind: 'shared_payment', amount: 400_000, sharedExpenseId, occurrence: { ruleId: RENT } },
    ])
    expect(ledger.sharedExpenses).toMatchObject([
      { id: sharedExpenseId, total: 400_000, payerId: 'diego', categoryId: 'arriendo', date: '2026-11-05' },
    ])
    const [entry] = await store.audit({ last: 1 })
    expect(entry?.operation).toBe('occurrence.confirm')
    expect(entry?.changes.map((change) => change.table)).toEqual(['sharedExpenses', 'transactions'])
    expect(await store.ledgerIssues()).toEqual([])

    // His expense of the month is his half; the household owes him the other half.
    const snapshot = financialSnapshot(toSnapshotInput(ledger, d('2026-11-10')))
    expect(snapshot.totals.expense).toBe(200_000)
    expect(snapshot.householdBalance).toBe(200_000)
  })

  it('si el gasto compartido no es válido, tampoco queda el pago', async () => {
    const { store } = await withRentRule('diego')
    await expect(
      store.confirmOccurrence({
        ref: { ruleId: RENT, dueDate: d('2026-11-05') },
        date: d('2026-11-05'),
        shared: { description: 'Arriendo (prueba)', shares: [{ participantId: toId('vecino'), weight: 1 }] },
      }),
    ).rejects.toThrow('no es miembro')
    const ledger = await store.ledger()
    expect(ledger.transactions).toEqual([])
    expect(ledger.sharedExpenses).toEqual([])
  })

  it('quien no paga marca que el gasto compartido cubre su programado, y deja de deberlo dos veces', async () => {
    const { store } = await withRentRule('pablo')
    const { sharedExpenseId } = await store.recordSharedExpense(rent(DIEGO, { total: clp(400_000) }))
    const ref = { ruleId: RENT, dueDate: d('2026-11-05') }
    const today = d('2026-11-10')

    const before = financialSnapshot(toSnapshotInput(await store.ledger(), today))
    await store.coverOccurrence(ref, sharedExpenseId)
    const after = financialSnapshot(toSnapshotInput(await store.ledger(), today))
    // The programmed rent of November (400.000) is no longer owed: only the debt with the household.
    expect(before.obligationsTotal - after.obligationsTotal).toBe(400_000)

    await store.uncoverOccurrence(ref)
    const back = financialSnapshot(toSnapshotInput(await store.ledger(), today))
    expect(back.obligationsTotal).toBe(before.obligationsTotal)
  })

  it('una cobertura sin sentido se rechaza', async () => {
    const { store } = await withRentRule('pablo')
    const ref = { ruleId: RENT, dueDate: d('2026-11-05') }
    const taxi = await store.recordSharedExpense(rent(DIEGO, { categoryId: cat('transporte') }))
    expect(await failureOf(store.coverOccurrence(ref, taxi.sharedExpenseId))).toMatchObject({ code: 'invalid_input' })

    const first = await store.recordSharedExpense(rent(DIEGO))
    await store.coverOccurrence(ref, first.sharedExpenseId)
    // The same shared expense cannot cover a second programmed expense.
    expect(
      await failureOf(store.coverOccurrence({ ruleId: RENT, dueDate: d('2026-10-05') }, first.sharedExpenseId)),
    ).toMatchObject({ code: 'conflict' })
  })
})
