import { describe, expect, it } from 'vitest'
import {
  type AccountId,
  type RuleId,
  accountBalance,
  balancesFromHistory,
  equalShares,
  financialSnapshot,
  toId,
} from '@/domain'
import { DIEGO, MEMBERS, PABLO, cat, clp, d } from '@/domain/testing/builders'
import { exportBackup, importBackup, noteBackupSaved, readBackup } from './backup/backup'
import { canonicalJson, sha256Hex } from './backup/canonical'
import { CURRENT_SCHEMA_VERSION, SCHEMA_VERSIONS, type SchemaVersion, openDatabase } from './dexie/database'
import { type ProfileStore, toSnapshotInput } from './ports'
import type { ProfileId, ProfileSnapshot } from './records'
import { failureOf, memoryIndexedDb, rawContent, testPhone } from './testing/harness'

/**
 * One test for every finding of the independent review of the data layer (10 November 2026).
 * Each of them reproduced a real way to damage the data before it was fixed.
 */

const CHECKING: AccountId = toId('corriente')
const SAVINGS: AccountId = toId('ahorro')
const RENT: RuleId = toId('arriendo')
const TODAY = d('2026-11-10')

async function prepared(profile: ProfileId = 'pablo') {
  const phone = testPhone('2026-11-10')
  const session = await phone.open(profile)
  const { store } = session
  for (const [id, kind] of [
    [CHECKING, 'checking'],
    [SAVINGS, 'savings'],
  ] as const) {
    await store.createAccount({
      id,
      name: kind === 'checking' ? 'Cuenta de prueba' : 'Ahorro de prueba',
      kind,
      openingBalance: clp(kind === 'checking' ? 1_000_000 : 0),
      openingDate: d('2026-10-01'),
    })
  }
  return { phone, session, store }
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

const rent = (payerId = PABLO, extra: object = {}) => ({
  date: d('2026-11-05'),
  description: 'Arriendo de prueba',
  categoryId: cat('arriendo'),
  total: clp(200_000),
  payerId,
  shares: equalShares(MEMBERS),
  ...extra,
})

async function withRentRule(store: ProfileStore): Promise<void> {
  await store.createRule({
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
}

const balance = async (store: ProfileStore, accountId: AccountId): Promise<number> => {
  const ledger = await store.ledger()
  return accountBalance(balancesFromHistory(ledger.accounts, ledger.transactions), accountId)
}

const failure = async (promise: Promise<unknown>): Promise<unknown> => promise.then(() => null, (error: unknown) => error)

describe('1 · nada de lo guardado puede dejar al perfil sin respaldo', () => {
  it('una clave de operación vacía o demasiado larga se rechaza antes de guardar nada', async () => {
    const { store } = await prepared()
    for (const idempotencyKey of ['', 'x'.repeat(121), 7 as never]) {
      expect(await failureOf(store.recordTransaction(groceries(1_000), { idempotencyKey }))).toMatchObject({
        code: 'invalid_input',
      })
    }
    expect(await store.transactions()).toEqual([])
    await store.recordTransaction(groceries(1_000), { idempotencyKey: 'x'.repeat(120) })
    expect(await store.transactions()).toHaveLength(1)
  })

  it('aunque una fila guardada esté mal formada, el respaldo igual se entrega, con el problema a la vista', async () => {
    const { phone, session, store } = await prepared()
    await store.recordTransaction(groceries(1_000))
    // A row no operation of the app could write: put there behind its back.
    const raw = await openDatabase('nexo-pablo', phone.idb)
    await raw.settings.put({ key: 'rota', value: undefined as never, updatedAt: 'ayer' })
    raw.close()

    const file = await exportBackup(session, phone.env)
    expect(file.bytes.length).toBeGreaterThan(100)
    expect(file.problems.length).toBeGreaterThan(0)
    // The data is in the file, whole: nothing was withheld.
    expect(new TextDecoder().decode(file.bytes)).toContain('"amount":1000')
    // And such a file is not taken back as if it were fine.
    expect(await failure(importBackup(session, file.bytes, phone.env))).toMatchObject({ code: 'invalid_content' })
  })

  it('un respaldo con problemas no cuenta como respaldo hecho', async () => {
    const { phone, session, store } = await prepared()
    const raw = await openDatabase('nexo-pablo', phone.idb)
    await raw.settings.put({ key: 'rota', value: undefined as never, updatedAt: 'ayer' })
    raw.close()
    const pending = (await store.deviceState()).changesSinceBackup

    const broken = await exportBackup(session, phone.env)
    expect(await noteBackupSaved(session, broken)).toBe(false)
    expect(await store.deviceState()).toMatchObject({ changesSinceBackup: pending, lastBackupAt: null })
  })

  it('lo que se guarda es lo que un respaldo puede llevar: ningún campo «sin valor» escondido', async () => {
    const { phone, store } = await prepared()
    await store.createAccount({
      id: toId('tarjeta'),
      name: 'Tarjeta de prueba',
      kind: 'credit_card',
      openingBalance: clp(0),
      openingDate: d('2026-10-01'),
      paymentDay: 5,
    })
    await store.recordTransaction({
      ...groceries(9_000, { accountId: toId('tarjeta') }),
      installments: { count: 1, firstDueDate: d('2026-12-05'), dueDay: undefined },
    })
    const [row] = (await rawContent(phone)).transactions as { installments: object }[]
    expect(Object.keys(row?.installments ?? {})).toEqual(['count', 'firstDueDate'])
  })

  it('una preferencia con un valor que un respaldo no puede llevar se rechaza', async () => {
    const { phone, session, store } = await prepared()
    for (const value of [undefined, () => 1, Number.NaN, { dentro: undefined }]) {
      await expect(store.setSetting('x', value as never)).rejects.toThrow()
    }
    await expect(store.setSetting('', 'valor')).rejects.toThrow()
    expect(await store.settings()).toEqual({})
    expect((await exportBackup(session, phone.env)).problems).toEqual([])
  })
})

describe('2 y 16 · desde cuándo se registra se deduce de las cuentas: no hay fecha que mover a mano', () => {
  it('el contrato ya no ofrece cambiar esa fecha', async () => {
    const { store } = await prepared()
    expect('setStartedOn' in store).toBe(false)
  })

  it('no hay forma de anular la salida de dinero de un gasto compartido y dejar el gasto en pie', async () => {
    const { store } = await prepared()
    const { transactionId } = await store.recordSharedExpense({ ...rent(), payment: { accountId: CHECKING } })
    if (transactionId === null) {
      throw new Error('se esperaba un pago')
    }
    expect(await failureOf(store.voidTransaction(transactionId))).toMatchObject({ code: 'ledger_mismatch' })
    // Moving the opening of the accounts forward would make the payment «older than the start»…
    expect(await failureOf(store.updateAccount(CHECKING, { openingDate: d('2026-11-08') }))).toMatchObject({
      code: 'conflict',
    })
    expect(await balance(store, CHECKING)).toBe(800_000)
    expect(await store.ledgerIssues()).toEqual([])
  })

  it('abrir una cuenta más antigua no puede dejar sin pago un gasto compartido anterior ya registrado', async () => {
    const phone = testPhone('2026-11-10')
    const { store } = await phone.open('pablo')
    await store.createAccount({
      id: CHECKING,
      name: 'Cuenta de prueba',
      kind: 'checking',
      openingBalance: clp(500_000),
      openingDate: d('2026-11-01'),
    })
    // Paid by Pablo before his first account opened: no cash movement is expected for it.
    await store.recordSharedExpense(rent(PABLO, { date: d('2026-10-20') }))
    expect(await store.ledgerIssues()).toEqual([])

    const failed = await failureOf(
      store.createAccount({
        name: 'Cuenta más antigua',
        kind: 'cash',
        openingBalance: clp(0),
        openingDate: d('2026-10-01'),
      }),
    )
    expect(failed).toMatchObject({ code: 'ledger_mismatch' })
    expect(await store.accounts()).toHaveLength(1)
    expect(await store.ledgerIssues()).toEqual([])
  })

  it('un gasto compartido pagado antes de abrir la primera cuenta se puede registrar', async () => {
    const phone = testPhone('2026-11-09')
    const { store } = await phone.open('pablo')
    phone.env.setToday('2026-11-12')
    await store.createAccount({
      id: CHECKING,
      name: 'Cuenta de prueba',
      kind: 'checking',
      openingBalance: clp(500_000),
      openingDate: d('2026-11-12'),
    })
    // The profile exists since the 9th, the account since the 12th, the expense is of the 10th.
    const { transactionId } = await store.recordSharedExpense(rent(PABLO, { date: d('2026-11-10') }))
    expect(transactionId).toBeNull()
    expect(await store.ledgerIssues()).toEqual([])
  })
})

describe('3 · una tienda solo guarda los datos de su propio perfil', () => {
  it('las cifras de la Demo no entran a Pablo ni por la puerta de atrás', async () => {
    const phone = testPhone()
    const pablo = await phone.open('pablo')
    const demo = await phone.open('demo')
    const before = await rawContent(phone, 'pablo')

    const invented = await demo.store.exportSnapshot()
    expect(await failureOf(pablo.store.replaceWith(invented))).toMatchObject({ code: 'conflict' })
    // Not even with the header of the snapshot forged to say «Pablo» while it is still a demo.
    expect(
      await failureOf(pablo.store.replaceWith({ ...invented, meta: { ...invented.meta, id: 'pablo' } })),
    ).toMatchObject({ code: 'conflict' })
    expect(await rawContent(phone, 'pablo')).toStrictEqual(before)

    const diego = await phone.open('diego')
    expect(await failureOf(diego.store.replaceWith(await pablo.store.exportSnapshot()))).toMatchObject({
      code: 'conflict',
    })
    expect(await failureOf(demo.store.replaceWith(await pablo.store.exportSnapshot()))).toMatchObject({
      code: 'conflict',
    })
  })
})

describe('3 · una base que guarda el perfil de otra persona no se abre', () => {
  it('se rechaza al abrir, sin tocar nada', async () => {
    const phone = testPhone()
    ;(await phone.open('pablo')).close()
    const raw = await openDatabase('nexo-pablo', phone.idb)
    const meta = await raw.meta.get('profile')
    if (meta === undefined) {
      throw new Error('falta el perfil')
    }
    await raw.meta.put({ ...meta, id: 'diego', memberId: toId('diego'), name: 'Diego' })
    raw.close()

    expect(await failureOf(phone.open('pablo'))).toMatchObject({ code: 'conflict' })
    const again = await openDatabase('nexo-pablo', phone.idb)
    expect((await again.meta.get('profile'))?.id).toBe('diego')
    again.close()
  })
})

describe('4 · restaurar deja constancia en la auditoría', () => {
  it('la entrada dice qué respaldo se restauró, y es la misma cada vez', async () => {
    const { phone, session, store } = await prepared()
    const file = await exportBackup(session, phone.env)
    const { transactionId } = await store.recordTransaction(groceries(99_000))
    await store.voidTransaction(transactionId)

    await importBackup(session, file.bytes, phone.env)
    const trail = await store.audit()
    expect(trail[0]).toStrictEqual({
      seq: file.throughSeq + 1,
      at: file.exportedAt,
      operation: 'profile.restore',
      changes: [],
      result: { exportId: file.exportId, exportedAt: file.exportedAt, records: 2 },
    })
    // What was registered after the backup is gone, as restoring means; the restore itself is not.
    expect(trail.map((entry) => entry.operation)).toEqual([
      'profile.restore',
      'account.create',
      'account.create',
      'profile.seed',
    ])

    phone.env.setToday('2026-11-20')
    await importBackup(session, file.bytes, phone.env)
    expect(await store.audit()).toStrictEqual(trail)
    // When each restore happened is kept on the device, apart from the person's data.
    expect((await store.deviceState()).restores).toHaveLength(2)
  })
})

describe('5 · cortar una regla no deja una cobertura apuntando a nada', () => {
  it('con una cobertura posterior al corte, el corte se rechaza; al quitarla, pasa', async () => {
    const { store } = await prepared('pablo')
    await withRentRule(store)
    const { sharedExpenseId } = await store.recordSharedExpense(rent(DIEGO, { total: clp(400_000) }))
    const ref = { ruleId: RENT, dueDate: d('2026-11-05') }
    await store.coverOccurrence(ref, sharedExpenseId)
    const obligations = async () =>
      financialSnapshot(toSnapshotInput(await store.ledger(), TODAY)).obligationsTotal
    const before = await obligations()

    const cut = { lastDayOfOld: d('2026-10-31'), startDate: d('2026-11-08') }
    expect(await failureOf(store.rescheduleRule(RENT, cut))).toMatchObject({ code: 'conflict' })
    expect(await failureOf(store.closeRule(RENT, d('2026-10-31')))).toMatchObject({ code: 'conflict' })
    expect(await store.rules()).toHaveLength(1)
    expect(await obligations()).toBe(before)

    await store.uncoverOccurrence(ref)
    const { ruleId } = await store.rescheduleRule(RENT, cut)
    // The same shared expense can now cover the rent under its new date.
    await store.coverOccurrence({ ruleId, dueDate: d('2026-11-08') }, sharedExpenseId)
    expect(await obligations()).toBe(before)
  })

  it('un «me lo salto» posterior al corte se elimina en la misma operación', async () => {
    const { store } = await prepared()
    await withRentRule(store)
    await store.skipOccurrence({ ruleId: RENT, dueDate: d('2026-10-05') })
    await store.skipOccurrence({ ruleId: RENT, dueDate: d('2026-11-05') })

    await store.closeRule(RENT, d('2026-10-31'))
    expect((await store.ledger()).cancelledOccurrences).toMatchObject([{ dueDate: '2026-10-05' }])
    const [entry] = await store.audit({ last: 1 })
    expect(entry?.changes.map((change) => [change.table, change.action])).toEqual([
      ['cancelledOccurrences', 'remove'],
      ['rules', 'update'],
    ])
  })
})

describe('6 · la reserva liberada y su transferencia a la meta se deshacen juntas', () => {
  async function fulfilled() {
    const context = await prepared()
    const { store } = context
    const { goalId } = await store.createGoal({ name: 'Meta de prueba', target: clp(500_000) })
    await store.reserveForGoal({ goalId, amount: clp(100_000), date: d('2026-11-01') })
    const ids = await store.fulfilReservation({
      goalId,
      amount: clp(100_000),
      date: d('2026-11-05'),
      fromAccountId: CHECKING,
      toAccountId: SAVINGS,
    })
    const progress = async () =>
      financialSnapshot(toSnapshotInput(await store.ledger(), TODAY)).goals[0]
    return { ...context, ...ids, progress }
  }

  it('anular la liberación anula también la transferencia: el ahorro no se cuenta dos veces', async () => {
    const { store, reservationId, progress } = await fulfilled()
    expect(await progress()).toMatchObject({ reserved: 0, transferred: 100_000, accumulated: 100_000 })

    await store.voidReservation(reservationId)
    expect(await progress()).toMatchObject({ reserved: 100_000, transferred: 0, accumulated: 100_000 })
    expect(await balance(store, SAVINGS)).toBe(0)
    expect(await balance(store, CHECKING)).toBe(1_000_000)
    expect((await store.audit({ last: 1 }))[0]?.changes).toHaveLength(2)
  })

  it('anular la transferencia anula también la liberación', async () => {
    const { store, transactionId, progress } = await fulfilled()
    await store.voidTransaction(transactionId)
    expect(await progress()).toMatchObject({ reserved: 100_000, transferred: 0, accumulated: 100_000 })
    expect((await store.ledger()).reservations.filter((reservation) => reservation.voided)).toHaveLength(1)
  })

  it('esa transferencia no se edita por separado, y el vínculo viaja en los respaldos', async () => {
    const { phone, session, store, transactionId, reservationId } = await fulfilled()
    expect(
      await failureOf(
        store.editTransaction(transactionId, {
          kind: 'transfer',
          date: d('2026-11-05'),
          amount: clp(50_000),
          fromAccountId: CHECKING,
          toAccountId: SAVINGS,
        }),
      ),
    ).toMatchObject({ code: 'linked_record' })

    const file = await exportBackup(session, phone.env)
    await store.erase()
    await importBackup(session, file.bytes, phone.env)
    await store.voidReservation(reservationId)
    expect((await store.transactions()).find((transaction) => transaction.id === transactionId)?.voided).toBe(true)
  })
})

describe('7 · la detección de pérdida también ve un perfil sin movimientos', () => {
  it('con solo una preferencia guardada, una base borrada se detecta', async () => {
    const phone = testPhone()
    const session = await phone.open('pablo')
    await session.store.setSetting('humor', 'serio')
    expect(JSON.parse(phone.storage.items.get('nexo.marcador.pablo') ?? '{}')).toMatchObject({
      records: 0,
      operations: 1,
    })
    session.close()

    const { openProfile } = await import('./session')
    const lost = await openProfile('pablo', { ...testPhone().idb, env: phone.env, markerStorage: phone.storage })
    expect(lost.loss).toMatchObject({ records: 0, operations: 1 })
  })

  it('un perfil recién creado que nadie usó no avisa nada si su base desaparece', async () => {
    const phone = testPhone()
    ;(await phone.open('pablo')).close()
    const { openProfile } = await import('./session')
    const again = await openProfile('pablo', { ...testPhone().idb, env: phone.env, markerStorage: phone.storage })
    expect(again.loss).toBeNull()
    expect(again.isNew).toBe(true)
  })
})

describe('9 y 14 · una clave de operación siempre viene con lo mismo', () => {
  it('la misma clave con otro contenido se rechaza en vez de responder «listo»', async () => {
    const { store } = await prepared()
    await store.recordTransaction(groceries(5_000), { idempotencyKey: 'formulario' })
    expect(await failureOf(store.recordTransaction(groceries(12_000), { idempotencyKey: 'formulario' }))).toMatchObject({
      code: 'conflict',
    })
    // The very same form again is still answered without registering twice.
    await store.recordTransaction(groceries(5_000), { idempotencyKey: 'formulario' })
    expect((await store.transactions()).map((transaction) => transaction.amount)).toEqual([5_000])
  })

  it('la misma clave no sirve para dos operaciones distintas, aunque manden lo mismo', async () => {
    const { store } = await prepared()
    await withRentRule(store)
    const ref = { ruleId: RENT, dueDate: d('2026-11-05') }
    await store.skipOccurrence(ref, { idempotencyKey: 'una-sola-vez' })
    expect(await failureOf(store.unskipOccurrence(ref, { idempotencyKey: 'una-sola-vez' }))).toMatchObject({
      code: 'conflict',
    })
    expect((await store.ledger()).cancelledOccurrences).toHaveLength(1)
  })

  it('al confirmar un programado, un conflicto de clave o de identificador se llama por su nombre', async () => {
    const { store } = await prepared()
    await withRentRule(store)
    await store.recordTransaction({ ...groceries(1_000), id: toId('repetido') }, { idempotencyKey: 'otra-operacion' })
    const ref = { ruleId: RENT, dueDate: d('2026-11-05') }

    const reusedKey = await failureOf(
      store.confirmOccurrence({ ref, date: d('2026-11-05') }, { idempotencyKey: 'otra-operacion' }),
    )
    expect(reusedKey).toMatchObject({ code: 'conflict' })
    const repeatedId = await failureOf(
      store.confirmOccurrence({ ref, date: d('2026-11-05'), transactionId: toId('repetido') }),
    )
    expect(repeatedId).toMatchObject({ code: 'conflict' })
    expect((repeatedId as Error).message).toContain('identificador')

    await store.confirmOccurrence({ ref, date: d('2026-11-05') })
    expect(await failureOf(store.confirmOccurrence({ ref, date: d('2026-11-05') }))).toMatchObject({
      name: 'DomainError',
    })
  })
})

describe('11 · el rescate no esconde los registros del hogar desparejados', () => {
  it('se informan junto con las contradicciones aceptadas', async () => {
    const { phone, session, store } = await prepared()
    await store.recordSharedExpense(rent(DIEGO))
    await store.setBudget({ categoryId: cat('ocio'), month: '2026-08' as never, planned: clp(1), funded: false })
    const envelope = JSON.parse(new TextDecoder().decode((await exportBackup(session, phone.env)).bytes)) as {
      data: ProfileSnapshot
      checksum: string
    }
    ;(envelope.data.sharedExpenses[0] as { payerId: string }).payerId = 'pablo'
    ;(envelope.data.budgets[0] as { planned: number }).planned = -1
    envelope.checksum = await sha256Hex(canonicalJson(envelope.data))
    const altered = new TextEncoder().encode(JSON.stringify(envelope))

    const rescued = await importBackup(session, altered, phone.env, { acceptProblems: true })
    expect(rescued.problems).toHaveLength(1)
    expect(rescued.ledgerIssues).toMatchObject([{ kind: 'expense_without_payment' }])
  })
})

describe('12 · editar un movimiento no puede hacerlo pasar por la confirmación de un programado', () => {
  it('se rechaza aunque alguien se salte los tipos', async () => {
    const { store } = await prepared()
    await withRentRule(store)
    const { transactionId } = await store.recordTransaction(groceries(1_000))
    const sneaky = { ...groceries(1_000), occurrence: { ruleId: RENT, dueDate: d('2026-11-05') } }
    expect(await failureOf(store.editTransaction(transactionId, sneaky as never))).toMatchObject({
      code: 'invalid_input',
    })
    expect((await store.transactions())[0]).not.toHaveProperty('occurrence')
  })
})

describe('18 · la importación exige lo mismo que la escritura', () => {
  it('rechaza reglas, presupuestos, gastos compartidos y reservas que apuntan a algo que no existe', async () => {
    const { phone, session, store } = await prepared()
    await withRentRule(store)
    await store.recordSharedExpense(rent(DIEGO))
    await store.setBudget({ categoryId: cat('ocio'), month: '2026-11' as never, planned: clp(1), funded: false })
    const { goalId } = await store.createGoal({ name: 'Meta de prueba', target: clp(1_000) })
    await store.reserveForGoal({ goalId, amount: clp(100), date: d('2026-11-01') })
    const file = await exportBackup(session, phone.env)

    const lies: [string, (data: ProfileSnapshot) => void][] = [
      ['La categoría no existe', (data) => ((data.rules[0] as { categoryId: string }).categoryId = 'borrada')],
      ['no es una categoría de gasto', (data) => ((data.rules[0] as { categoryId: string }).categoryId = 'sueldo')],
      ['La categoría no existe', (data) => ((data.budgets[0] as { categoryId: string }).categoryId = 'borrada')],
      ['La categoría no existe', (data) => ((data.sharedExpenses[0] as { categoryId: string }).categoryId = 'borrada')],
      ['La meta no existe', (data) => ((data.reservations[0] as { goalId: string }).goalId = 'borrada')],
    ]
    for (const [expected, lie] of lies) {
      const envelope = JSON.parse(new TextDecoder().decode(file.bytes)) as { data: ProfileSnapshot; checksum: string }
      lie(envelope.data)
      envelope.checksum = await sha256Hex(canonicalJson(envelope.data))
      const failed = await failure(readBackup(new TextEncoder().encode(JSON.stringify(envelope)), TODAY))
      expect(failed).toMatchObject({ code: 'invalid_content' })
      expect((failed as { problems: string[] }).problems.join(' ')).toContain(expected)
    }
  })
})

describe('una app antigua no toca una base más nueva', () => {
  it('ni siquiera cuando la versión nueva quitó una tabla que la antigua todavía declara', async () => {
    const phone = memoryIndexedDb()
    const first = await openDatabase('nexo-prueba', phone)
    first.close()
    // A newer version that is not additive: it drops a table.
    const newer: SchemaVersion = {
      version: CURRENT_SCHEMA_VERSION + 1,
      note: 'Prueba: quita una tabla',
      stores: { settings: null },
    }
    const upgraded = await openDatabase('nexo-prueba', phone, [...SCHEMA_VERSIONS, newer])
    const tables = upgraded.backendDB().objectStoreNames.length
    const version = upgraded.backendDB().version
    upgraded.close()

    expect(await failureOf(openDatabase('nexo-prueba', phone))).toMatchObject({ code: 'newer_schema' })

    // Nothing was «repaired»: same native version, and the dropped table is still gone.
    const again = await openDatabase('nexo-prueba', phone, [...SCHEMA_VERSIONS, newer])
    expect(again.backendDB().version).toBe(version)
    expect(again.backendDB().objectStoreNames.length).toBe(tables)
    expect([...again.backendDB().objectStoreNames]).not.toContain('settings')
    again.close()
  })

  it('preguntar por la versión de una base que no existe no la crea', async () => {
    const phone = memoryIndexedDb()
    const database = await openDatabase('nexo-nueva', phone)
    expect(database.verno).toBe(CURRENT_SCHEMA_VERSION)
    database.close()
    expect((await phone.indexedDB?.databases())?.map((entry) => entry.name)).toEqual(['nexo-nueva'])
  })
})
