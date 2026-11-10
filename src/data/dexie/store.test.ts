import { describe, expect, it } from 'vitest'
import {
  type AccountId,
  type RuleId,
  type TransactionId,
  accountBalance,
  balancesFromHistory,
  financialSnapshot,
  toId,
} from '@/domain'
import { cat, clp, d } from '@/domain/testing/builders'
import { DataError } from '../errors'
import { type ProfileStore, toSnapshotInput } from '../ports'
import { failureOf, testPhone } from '../testing/harness'

const CHECKING: AccountId = toId('corriente')
const SAVINGS: AccountId = toId('ahorro')
const CARD: AccountId = toId('tarjeta')

/** A profile with three accounts opened on 1 October 2026. «Today» is 10 November 2026. */
async function prepared() {
  const phone = testPhone('2026-11-10')
  const session = await phone.open('pablo')
  const { store } = session
  await store.createAccount({
    id: CHECKING,
    name: 'Cuenta de prueba',
    kind: 'checking',
    openingBalance: clp(500_000),
    openingDate: d('2026-10-01'),
  })
  await store.createAccount({
    id: SAVINGS,
    name: 'Ahorro de prueba',
    kind: 'savings',
    openingBalance: clp(0),
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

async function balanceOf(store: ProfileStore, accountId: AccountId): Promise<number> {
  const ledger = await store.ledger()
  return accountBalance(balancesFromHistory(ledger.accounts, ledger.transactions), accountId)
}

const groceries = (amount: number, extra: object = {}) =>
  ({
    kind: 'expense',
    date: d('2026-11-09'),
    amount: clp(amount),
    accountId: CHECKING,
    categoryId: cat('supermercado'),
    ...extra,
  }) as const

describe('perfil recién creado', () => {
  it('trae las categorías y el hogar, y ni un peso', async () => {
    const session = await testPhone().open('pablo')
    const ledger = await session.store.ledger()

    expect(session.isNew).toBe(true)
    expect(ledger.meta).toMatchObject({ id: 'pablo', kind: 'personal', memberId: 'pablo', startedOn: '2026-11-10' })
    expect(ledger.categories.map((category) => category.id)).toEqual(
      expect.arrayContaining(['arriendo', 'mascotas', 'veterinario', 'sueldo', 'honorarios']),
    )
    expect(ledger.members.map((member) => member.id)).toEqual(['diego', 'pablo'])
    expect(ledger.accounts).toEqual([])
    expect(ledger.transactions).toEqual([])
    expect((await session.store.audit()).map((entry) => entry.operation)).toEqual(['profile.seed'])
  })

  it('abrirlo otra vez no lo vuelve a preparar', async () => {
    const phone = testPhone()
    const first = await phone.open('pablo')
    await first.store.createAccount({
      name: 'Cuenta de prueba',
      kind: 'checking',
      openingBalance: clp(1_000),
      openingDate: d('2026-11-01'),
    })
    first.close()

    const second = await phone.open('pablo')
    expect(second.isNew).toBe(false)
    expect(await second.store.accounts()).toHaveLength(1)
    expect((await second.store.audit()).filter((entry) => entry.operation === 'profile.seed')).toHaveLength(1)
  })
})

describe('registrar movimientos', () => {
  it('un gasto queda guardado y baja el saldo; al reabrir la base sigue ahí', async () => {
    const { phone, session, store } = await prepared()
    const { transactionId } = await store.recordTransaction(groceries(35_990))
    expect(await balanceOf(store, CHECKING)).toBe(500_000 - 35_990)
    session.close()

    const reopened = await phone.open('pablo')
    const stored = await reopened.store.transactions()
    expect(stored.map((transaction) => transaction.id)).toEqual([transactionId])
    expect(await balanceOf(reopened.store, CHECKING)).toBe(500_000 - 35_990)
  })

  it('una transferencia mueve dos cuentas en la misma operación', async () => {
    const { store } = await prepared()
    await store.recordTransaction({
      kind: 'transfer',
      date: d('2026-11-05'),
      amount: clp(120_000),
      fromAccountId: CHECKING,
      toAccountId: SAVINGS,
    })
    expect(await balanceOf(store, CHECKING)).toBe(380_000)
    expect(await balanceOf(store, SAVINGS)).toBe(120_000)
  })

  it('siempre valida la categoría: una de ingreso no sirve para un gasto', async () => {
    const { store } = await prepared()
    const wrongKind = await failureOf(store.recordTransaction(groceries(1_000, { categoryId: cat('sueldo') })))
    expect(wrongKind).toMatchObject({ name: 'DomainError' })
    expect((wrongKind as Error).message).toContain('categoría de ingreso')

    const unknown = await failureOf(store.recordTransaction(groceries(1_000, { categoryId: cat('no-existe') })))
    expect((unknown as Error).message).toContain('La categoría no existe')
    expect(await store.transactions()).toEqual([])
  })

  it('rechaza lo que rompe una regla contable, y no guarda nada', async () => {
    const { store } = await prepared()
    const attempts = [
      groceries(1_000, { date: d('2026-11-11') }), // future
      groceries(1_000, { date: d('2026-09-30') }), // before the opening balance
      groceries(0),
      groceries(1_000, { accountId: toId<'account'>('no-existe') }),
      groceries(1_000, { amount: 10.5 }),
      groceries(1_000, { campoDesconocido: true }),
    ]
    for (const attempt of attempts) {
      await expect(store.recordTransaction(attempt as never)).rejects.toThrow()
    }
    expect(await store.transactions()).toEqual([])
    expect(await balanceOf(store, CHECKING)).toBe(500_000)
  })

  it('lee por rango de fechas, con los dos extremos incluidos y del más antiguo al más nuevo', async () => {
    const { store } = await prepared()
    for (const date of ['2026-11-03', '2026-10-31', '2026-11-01', '2026-11-09', '2026-10-15']) {
      await store.recordTransaction(groceries(1_000, { date: d(date) }))
    }
    // Registered later, but with an identifier that sorts before every other one.
    await store.recordTransaction(groceries(2_000, { date: d('2026-11-01'), id: toId('a-registrado-despues') }))
    const dates = async (range?: Parameters<typeof store.transactions>[0]) =>
      (await store.transactions(range)).map((transaction) => transaction.date)

    expect(await dates()).toEqual(['2026-10-15', '2026-10-31', '2026-11-01', '2026-11-01', '2026-11-03', '2026-11-09'])
    expect(await dates({ from: d('2026-11-01'), to: d('2026-11-03') })).toEqual(['2026-11-01', '2026-11-01', '2026-11-03'])
    expect(await dates({ from: d('2026-11-03') })).toEqual(['2026-11-03', '2026-11-09'])
    expect(await dates({ to: d('2026-10-31') })).toEqual(['2026-10-15', '2026-10-31'])
    // Two movements of the same day stay in the order they were registered.
    const sameDay = (await store.transactions({ from: d('2026-11-01'), to: d('2026-11-01') })).map((item) => item.amount)
    expect(sameDay).toEqual([1_000, 2_000])
  })

  it('un movimiento hecho a mano no puede decir que confirma un programado', async () => {
    const { store } = await prepared()
    const sneaky = groceries(1_000, { occurrence: { ruleId: 'arriendo', dueDate: '2026-11-05' } })
    expect(await failureOf(store.recordTransaction(sneaky as never))).toMatchObject({ code: 'invalid_input' })
    expect(await store.transactions()).toEqual([])
  })

  it('un pago de gasto compartido no se registra a mano: va con su gasto compartido', async () => {
    const { store } = await prepared()
    const failure = await failureOf(
      store.recordTransaction({
        kind: 'shared_payment',
        date: d('2026-11-09'),
        amount: clp(10_000),
        accountId: CHECKING,
        sharedExpenseId: toId('x'),
      } as never),
    )
    expect(failure).toMatchObject({ code: 'linked_record' })
  })
})

describe('idempotencia', () => {
  it('la misma clave dos veces registra una sola vez y responde lo mismo', async () => {
    const { store } = await prepared()
    const first = await store.recordTransaction(groceries(8_000), { idempotencyKey: 'formulario-1' })
    const second = await store.recordTransaction(groceries(8_000), { idempotencyKey: 'formulario-1' })

    expect(second).toEqual(first)
    expect(await store.transactions()).toHaveLength(1)
    expect((await store.audit()).filter((entry) => entry.idempotencyKey === 'formulario-1')).toHaveLength(1)
    expect(await balanceOf(store, CHECKING)).toBe(492_000)
  })

  it('un doble toque simultáneo también registra una sola vez', async () => {
    const { store } = await prepared()
    const [first, second] = await Promise.all([
      store.recordTransaction(groceries(8_000), { idempotencyKey: 'doble-toque' }),
      store.recordTransaction(groceries(8_000), { idempotencyKey: 'doble-toque' }),
    ])
    expect(second).toEqual(first)
    expect(await store.transactions()).toHaveLength(1)
  })

  it('una clave ya usada para otra operación se rechaza', async () => {
    const { store } = await prepared()
    await store.recordTransaction(groceries(8_000), { idempotencyKey: 'clave' })
    const failure = await failureOf(
      store.createGoal({ name: 'Meta de prueba', target: clp(1_000) }, { idempotencyKey: 'clave' }),
    )
    expect(failure).toMatchObject({ code: 'conflict' })
  })

  it('dos formularios distintos con el mismo identificador de registro no duplican', async () => {
    const { store } = await prepared()
    const id: TransactionId = toId('mov-1')
    await store.recordTransaction({ ...groceries(8_000), id })
    const failure = await failureOf(store.recordTransaction({ ...groceries(9_000), id }))
    expect(failure).toMatchObject({ code: 'conflict' })
    expect(await store.transactions()).toHaveLength(1)
  })
})

describe('anular y editar dejan rastro', () => {
  it('anular no borra: el movimiento queda marcado y deja de contar', async () => {
    const { store } = await prepared()
    const { transactionId } = await store.recordTransaction(groceries(40_000))
    await store.voidTransaction(transactionId)

    const [stored] = await store.transactions()
    expect(stored).toMatchObject({ id: transactionId, voided: true, amount: 40_000 })
    expect(await balanceOf(store, CHECKING)).toBe(500_000)

    const [entry] = await store.audit({ last: 1 })
    expect(entry).toMatchObject({ operation: 'transaction.void' })
    expect(entry?.changes[0]).toMatchObject({
      table: 'transactions',
      key: transactionId,
      action: 'void',
      before: { voided: false },
      after: { voided: true },
      changed: ['voided'],
    })
  })

  it('anular dos veces no agrega nada', async () => {
    const { store } = await prepared()
    const { transactionId } = await store.recordTransaction(groceries(40_000))
    await store.voidTransaction(transactionId)
    const entries = (await store.audit()).length
    await store.voidTransaction(transactionId)
    expect((await store.audit()).length).toBe(entries)
  })

  it('editar guarda cómo era y cómo quedó: monto y categoría', async () => {
    const { store } = await prepared()
    const { transactionId } = await store.recordTransaction(groceries(40_000))
    await store.editTransaction(transactionId, groceries(45_500, { categoryId: cat('mascotas') }))

    expect(await balanceOf(store, CHECKING)).toBe(454_500)
    const [entry] = await store.audit({ last: 1 })
    expect(entry?.operation).toBe('transaction.edit')
    expect(entry?.changes[0]).toMatchObject({
      action: 'update',
      before: { amount: 40_000, categoryId: 'supermercado' },
      after: { amount: 45_500, categoryId: 'mascotas' },
      changed: ['amount', 'categoryId'],
    })
  })

  it('un movimiento anulado no se edita, y el tipo de un movimiento no cambia', async () => {
    const { store } = await prepared()
    const { transactionId } = await store.recordTransaction(groceries(40_000))
    expect(
      await failureOf(
        store.editTransaction(transactionId, {
          kind: 'adjustment',
          date: d('2026-11-09'),
          amount: clp(5),
          accountId: CHECKING,
        }),
      ),
    ).toMatchObject({ code: 'invalid_input' })
    await store.voidTransaction(transactionId)
    expect(await failureOf(store.editTransaction(transactionId, groceries(1)))).toMatchObject({ code: 'conflict' })
  })

  it('la auditoría numera las operaciones en orden y la interfaz no ofrece borrarla', async () => {
    const { store } = await prepared()
    await store.recordTransaction(groceries(1_000))
    const seqs = (await store.audit()).map((entry) => entry.seq)
    expect(seqs).toEqual(seqs.toSorted((a, b) => b - a))
    expect(new Set(seqs).size).toBe(seqs.length)
    expect(seqs.at(-1)).toBe(1)
    const names = new Set<string>()
    for (let object: object | null = store; object !== null && object !== Object.prototype; object = Object.getPrototypeOf(object) as object | null) {
      for (const name of Object.getOwnPropertyNames(object)) {
        names.add(name)
      }
    }
    // The methods are really being looked at (they live on the prototype)…
    expect(names.has('recordTransaction')).toBe(true)
    expect(names.has('audit')).toBe(true)
    // …and the only one about the trail is the one that reads it.
    expect([...names].filter((name) => /audit/i.test(name))).toEqual(['audit'])
  })
})

describe('cuentas', () => {
  it('el saldo inicial no puede empezar después de un movimiento ya registrado', async () => {
    const { store } = await prepared()
    await store.recordTransaction(groceries(1_000, { date: d('2026-10-15') }))
    expect(await failureOf(store.updateAccount(CHECKING, { openingDate: d('2026-10-20') }))).toMatchObject({
      code: 'conflict',
    })
    await store.updateAccount(CHECKING, { openingDate: d('2026-10-10'), name: 'Cuenta renombrada' })
    expect((await store.accounts()).find((account) => account.id === CHECKING)).toMatchObject({
      name: 'Cuenta renombrada',
      openingDate: '2026-10-10',
    })
  })

  it('archivar una cuenta no hace desaparecer su saldo', async () => {
    const { store } = await prepared()
    await store.updateAccount(CHECKING, { archived: true })
    expect(await balanceOf(store, CHECKING)).toBe(500_000)
  })

  it('una tarjeta puede perder su día de facturación, y una cuenta corriente no puede tener día de pago', async () => {
    const { store } = await prepared()
    await store.updateAccount(CARD, { statementDay: 20 })
    await store.updateAccount(CARD, { statementDay: undefined })
    const card = (await store.accounts()).find((account) => account.id === CARD)
    expect(card).not.toHaveProperty('statementDay')
    await expect(store.updateAccount(CHECKING, { paymentDay: 5 })).rejects.toThrow('Solo una tarjeta')
  })
})

describe('recurrentes', () => {
  const RENT: RuleId = toId('arriendo')

  async function withRent() {
    const context = await prepared()
    await context.store.createRule({
      id: RENT,
      kind: 'expense',
      label: 'Arriendo de prueba',
      amount: clp(300_000),
      amountIsEstimate: false,
      accountId: CHECKING,
      categoryId: cat('arriendo'),
      frequency: 'monthly',
      interval: 1,
      startDate: d('2026-10-05'),
    })
    return context
  }

  it('confirmar convierte el programado en un movimiento real, una sola vez', async () => {
    const { store } = await withRent()
    const ref = { ruleId: RENT, dueDate: d('2026-11-05') }
    const { transactionId } = await store.confirmOccurrence({ ref, date: d('2026-11-05') })

    const [movement] = await store.transactions()
    expect(movement).toMatchObject({ id: transactionId, kind: 'expense', amount: 300_000, occurrence: ref })
    expect(await balanceOf(store, CHECKING)).toBe(200_000)

    await expect(store.confirmOccurrence({ ref, date: d('2026-11-06') })).rejects.toThrow('ya fue confirmado')
    expect(await store.transactions()).toHaveLength(1)
  })

  it('dos confirmaciones simultáneas: pasa una sola', async () => {
    const { store } = await withRent()
    const ref = { ruleId: RENT, dueDate: d('2026-11-05') }
    const results = await Promise.allSettled([
      store.confirmOccurrence({ ref, date: d('2026-11-05') }),
      store.confirmOccurrence({ ref, date: d('2026-11-05') }),
    ])
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(await store.transactions()).toHaveLength(1)
  })

  it('el índice único de la base rechaza una segunda confirmación aunque alguien se salte la validación', async () => {
    const { phone, store } = await withRent()
    const ref = { ruleId: RENT, dueDate: d('2026-11-05') }
    await store.confirmOccurrence({ ref, date: d('2026-11-05') })

    // Straight into the table, behind the back of the store: only the database can refuse now.
    const { openDatabase } = await import('./database')
    const raw = await openDatabase('nexo-pablo', phone.idb)
    const [first] = await raw.transactions.toArray()
    expect(first?.occurrenceKey).toBe('arriendo|2026-11-05')
    const failure = await failureOf(raw.transactions.add({ ...first, id: toId('intruso') } as never))
    // How the refusal is worded depends on the browser; that it is refused does not.
    expect(failure).toBeInstanceOf(DataError)
    expect(['duplicate_confirmation', 'conflict']).toContain((failure as DataError).code)
    expect(await raw.transactions.count()).toBe(1)
    raw.close()
  })

  it('si se anula la confirmación, el programado vuelve a quedar pendiente y se puede confirmar otra vez', async () => {
    const { store } = await withRent()
    const ref = { ruleId: RENT, dueDate: d('2026-11-05') }
    const { transactionId } = await store.confirmOccurrence({ ref, date: d('2026-11-05') })
    await store.voidTransaction(transactionId)
    await store.confirmOccurrence({ ref, date: d('2026-11-07'), amount: clp(310_000) })

    const live = (await store.transactions()).filter((transaction) => !transaction.voided)
    expect(live).toHaveLength(1)
    expect(live[0]).toMatchObject({ amount: 310_000, date: '2026-11-07' })
  })

  it('corregir el monto de una confirmación no suelta el programado que confirma', async () => {
    const { store } = await withRent()
    const ref = { ruleId: RENT, dueDate: d('2026-11-05') }
    const { transactionId } = await store.confirmOccurrence({ ref, date: d('2026-11-05') })
    await store.editTransaction(transactionId, {
      kind: 'expense',
      date: d('2026-11-06'),
      amount: clp(305_000),
      accountId: CHECKING,
      categoryId: cat('arriendo'),
    })
    expect((await store.transactions())[0]).toMatchObject({ amount: 305_000, date: '2026-11-06', occurrence: ref })
    await expect(store.confirmOccurrence({ ref, date: d('2026-11-07') })).rejects.toThrow('ya fue confirmado')
  })

  it('un recurrente con una categoría que no existe no se puede confirmar', async () => {
    const { store } = await withRent()
    // Only a restored backup could bring this: a rule filed under a category nobody has.
    const snapshot = await store.exportSnapshot()
    await store.replaceWith({
      ...snapshot,
      rules: snapshot.rules.map((rule) => ({ ...rule, categoryId: cat('borrada') })),
    })
    await expect(
      store.confirmOccurrence({ ref: { ruleId: RENT, dueDate: d('2026-11-05') }, date: d('2026-11-05') }),
    ).rejects.toThrow('La categoría no existe')
    expect(await store.transactions()).toEqual([])
  })

  it('no se confirma una fecha que no es del recurrente, ni con fecha futura', async () => {
    const { store } = await withRent()
    expect(
      await failureOf(store.confirmOccurrence({ ref: { ruleId: RENT, dueDate: d('2026-11-06') }, date: d('2026-11-06') })),
    ).toMatchObject({ code: 'not_found' })
    await expect(
      store.confirmOccurrence({ ref: { ruleId: RENT, dueDate: d('2026-11-05') }, date: d('2026-11-20') }),
    ).rejects.toThrow('fecha futura')
  })

  it('saltarse un programado y arrepentirse', async () => {
    const { store } = await withRent()
    const ref = { ruleId: RENT, dueDate: d('2026-10-05') }
    await store.skipOccurrence(ref)
    await expect(store.confirmOccurrence({ ref, date: d('2026-10-05') })).rejects.toThrow('confirmado o cancelado')
    await store.unskipOccurrence(ref)
    await store.confirmOccurrence({ ref, date: d('2026-10-05') })
    expect(await failureOf(store.skipOccurrence(ref))).toMatchObject({ code: 'conflict' })
  })

  it('el calendario de una regla no se edita: la única vía es reprogramar', async () => {
    const { store } = await withRent()
    await store.confirmOccurrence({ ref: { ruleId: RENT, dueDate: d('2026-10-05') }, date: d('2026-10-05') })

    // @ts-expect-error The interface does not even offer `startDate`.
    const moved = store.updateRule(RENT, { startDate: d('2026-10-10') })
    expect(await failureOf(moved)).toMatchObject({ code: 'invalid_input' })
    // @ts-expect-error Nor the frequency.
    expect(await failureOf(store.updateRule(RENT, { frequency: 'weekly' }))).toMatchObject({ code: 'invalid_input' })

    await store.updateRule(RENT, { label: 'Arriendo con otro nombre', amount: clp(320_000) })
    const { ruleId } = await store.rescheduleRule(RENT, { lastDayOfOld: d('2026-11-30'), startDate: d('2026-12-10') })

    const rules = await store.rules()
    expect(rules.find((rule) => rule.id === RENT)).toMatchObject({ startDate: '2026-10-05', endDate: '2026-11-30' })
    expect(rules.find((rule) => rule.id === ruleId)).toMatchObject({
      startDate: '2026-12-10',
      amount: 320_000,
      label: 'Arriendo con otro nombre',
    })
    // What was confirmed under the old rule keeps pointing at it.
    expect((await store.transactions())[0]).toMatchObject({ occurrence: { ruleId: RENT, dueDate: '2026-10-05' } })
  })

  it('no se corta una regla antes de un pago ya confirmado', async () => {
    const { store } = await withRent()
    await store.confirmOccurrence({ ref: { ruleId: RENT, dueDate: d('2026-11-05') }, date: d('2026-11-05') })
    await expect(
      store.rescheduleRule(RENT, { lastDayOfOld: d('2026-10-31'), startDate: d('2026-11-10') }),
    ).rejects.toThrow('pago confirmado')
    expect(await failureOf(store.closeRule(RENT, d('2026-10-31')))).toMatchObject({ code: 'conflict' })
    await store.closeRule(RENT, d('2026-11-30'))
    expect(await failureOf(store.closeRule(RENT, d('2026-12-31')))).toMatchObject({ code: 'conflict' })
    expect(await store.rules()).toHaveLength(1)
  })

  it('un cargo programado a la tarjeta nace con su cuota', async () => {
    const { store } = await prepared()
    const ruleId: RuleId = toId('internet')
    await store.createRule({
      id: ruleId,
      kind: 'expense',
      label: 'Internet de prueba',
      amount: clp(20_000),
      amountIsEstimate: false,
      accountId: CARD,
      categoryId: cat('internet'),
      frequency: 'monthly',
      interval: 1,
      startDate: d('2026-10-12'),
    })
    await store.confirmOccurrence({ ref: { ruleId, dueDate: d('2026-10-12') }, date: d('2026-10-12') })
    const [movement] = await store.transactions()
    expect(movement).toMatchObject({ installments: { count: 1, firstDueDate: '2026-11-05', dueDay: 5 } })
  })
})

describe('presupuestos y metas', () => {
  it('un presupuesto se fija, se cambia y se quita', async () => {
    const { store } = await prepared()
    const budget = { categoryId: cat('supermercado'), month: '2026-11' as never, planned: clp(200_000), funded: true }
    await store.setBudget(budget)
    await store.setBudget({ ...budget, planned: clp(250_000) })
    expect(await store.budgets()).toMatchObject([{ planned: 250_000, funded: true }])
    await expect(store.setBudget({ ...budget, categoryId: cat('sueldo') })).rejects.toThrow('categoría de ingreso')
    expect(await store.removeBudget(budget.categoryId, budget.month)).toEqual({ removed: true })
    expect(await store.budgets()).toEqual([])
  })

  it('reservar no mueve ningún saldo; convertir la reserva en transferencia se guarda en una sola operación', async () => {
    const { store } = await prepared()
    const { goalId } = await store.createGoal({ name: 'Meta de prueba', target: clp(300_000) })
    await store.reserveForGoal({ goalId, amount: clp(100_000), date: d('2026-11-01') })
    expect(await balanceOf(store, CHECKING)).toBe(500_000)

    expect(
      await failureOf(store.releaseFromGoal({ goalId, amount: clp(150_000), date: d('2026-11-02') })),
    ).toMatchObject({ code: 'conflict' })

    const before = (await store.audit()).length
    await store.fulfilReservation({
      goalId,
      amount: clp(60_000),
      date: d('2026-11-08'),
      fromAccountId: CHECKING,
      toAccountId: SAVINGS,
    })
    expect((await store.audit()).length).toBe(before + 1)

    const snapshot = financialSnapshot(toSnapshotInput(await store.ledger(), d('2026-11-10')))
    expect(snapshot.goals[0]).toMatchObject({ reserved: 40_000, transferred: 60_000, accumulated: 100_000 })
    expect(await balanceOf(store, SAVINGS)).toBe(60_000)
  })

  it('una meta archivada ya no aparta dinero', async () => {
    const { store } = await prepared()
    const { goalId } = await store.createGoal({ name: 'Meta de prueba', target: clp(300_000) })
    await store.updateGoal(goalId, { archived: true })
    expect(await failureOf(store.reserveForGoal({ goalId, amount: clp(1_000), date: d('2026-11-01') }))).toMatchObject({
      code: 'conflict',
    })
    expect(
      await failureOf(store.reserveForGoal({ goalId: toId('no-existe'), amount: clp(1_000), date: d('2026-11-01') })),
    ).toMatchObject({ code: 'not_found' })
    await store.updateGoal(goalId, { archived: false })
    await expect(store.reserveForGoal({ goalId, amount: clp(1_000), date: d('2026-11-20') })).rejects.toThrow('fecha futura')
    await expect(store.reserveForGoal({ goalId, amount: clp(0), date: d('2026-11-01') })).rejects.toThrow('mayor que cero')
    const { reservationId } = await store.reserveForGoal({ goalId, amount: clp(1_000), date: d('2026-11-01') })
    await store.voidReservation(reservationId)
    expect((await store.ledger()).reservations).toMatchObject([{ id: reservationId, voided: true, amount: 1_000 }])
  })

  it('si la transferencia de la meta no es válida, tampoco se libera la reserva', async () => {
    const { store } = await prepared()
    const { goalId } = await store.createGoal({ name: 'Meta de prueba', target: clp(300_000) })
    await store.reserveForGoal({ goalId, amount: clp(100_000), date: d('2026-11-01') })
    await expect(
      store.fulfilReservation({
        goalId,
        amount: clp(60_000),
        date: d('2026-11-08'),
        fromAccountId: CHECKING,
        toAccountId: CARD, // not a savings account
      }),
    ).rejects.toThrow()
    const ledger = await store.ledger()
    expect(ledger.reservations).toHaveLength(1)
    expect(ledger.transactions).toEqual([])
  })
})

describe('preferencias', () => {
  it('se guardan, viajan con el perfil y quedan en la auditoría', async () => {
    const { store } = await prepared()
    await store.setSetting('humor', 'serio')
    await store.setSetting('humor', 'narrativo')
    expect(await store.settings()).toEqual({ humor: 'narrativo' })
    expect((await store.audit({ last: 1 }))[0]).toMatchObject({ operation: 'setting.set' })
    expect((await store.exportSnapshot()).settings).toMatchObject([{ key: 'humor', value: 'narrativo' }])
  })
})

describe('errores explicados', () => {
  it('un registro que no existe', async () => {
    const { store } = await prepared()
    const failure = await failureOf(store.voidTransaction(toId('no-existe')))
    expect(failure).toBeInstanceOf(DataError)
    expect(failure).toMatchObject({ code: 'not_found' })
  })
})
