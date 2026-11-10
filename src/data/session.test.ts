import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { financialSnapshot, fromEpochDay, projectScenarios, toEpochDay, addDays } from '@/domain'
import { cat, clp, d } from '@/domain/testing/builders'
import { exportBackup, importBackup } from './backup/backup'
import { checkSnapshot } from './backup/integrity'
import { DEMO_MARK, buildDemoSnapshot } from './demo/dataset'
import { toSnapshotInput } from './ports'
import { PROFILES, profileDescriptor } from './profiles'
import { profileSnapshotSchema } from './schemas'
import { deleteDemo, resetDemo } from './session'
import { failureOf, rawContent, testPhone } from './testing/harness'

const account = {
  name: 'Cuenta de prueba',
  kind: 'checking',
  openingBalance: clp(100_000),
  openingDate: d('2026-11-01'),
} as const

describe('perfiles separados', () => {
  it('hay tres perfiles: Pablo, Diego y Demo', () => {
    expect(PROFILES.map((profile) => [profile.id, profile.kind])).toEqual([
      ['pablo', 'personal'],
      ['diego', 'personal'],
      ['demo', 'demo'],
    ])
  })

  it('lo que registra Pablo no aparece en Diego ni en la Demo', async () => {
    const phone = testPhone()
    const pablo = await phone.open('pablo')
    const diego = await phone.open('diego')
    const demo = await phone.open('demo')
    const demoBefore = await rawContent(phone, 'demo')

    const { accountId } = await pablo.store.createAccount(account)
    await pablo.store.recordTransaction({
      kind: 'expense',
      date: d('2026-11-09'),
      amount: clp(12_345),
      accountId,
      categoryId: cat('supermercado'),
    })

    expect(await diego.store.accounts()).toEqual([])
    expect(await diego.store.transactions()).toEqual([])
    expect((await diego.store.audit()).map((entry) => entry.operation)).toEqual(['profile.seed'])
    expect(await rawContent(phone, 'demo')).toEqual(demoBefore)
    expect(JSON.stringify(await rawContent(phone, 'demo'))).not.toContain('12345')
    expect((await diego.store.profile()).memberId).toBe('diego')
    expect((await demo.store.profile()).kind).toBe('demo')
  })

  it('borrar los datos de un perfil no toca a los otros', async () => {
    const phone = testPhone()
    const pablo = await phone.open('pablo')
    const diego = await phone.open('diego')
    await pablo.store.createAccount(account)
    await diego.store.createAccount(account)
    const diegoBefore = await rawContent(phone, 'diego')

    await pablo.store.erase()
    expect((await rawContent(phone, 'pablo')).accounts).toEqual([])
    expect(await rawContent(phone, 'diego')).toEqual(diegoBefore)
  })
})

describe('perfil Demo: ficticio y aislado', () => {
  it('nace con datos, todos marcados como de ejemplo', async () => {
    const demo = await testPhone().open('demo')
    const ledger = await demo.store.ledger()

    expect(ledger.accounts.length).toBeGreaterThan(0)
    expect(ledger.transactions.length).toBeGreaterThan(50)
    for (const item of ledger.accounts) {
      expect(item.name).toContain(DEMO_MARK)
      expect(item.id.startsWith('demo-')).toBe(true)
    }
    for (const transaction of ledger.transactions) {
      expect(transaction.note).toContain(DEMO_MARK)
      expect(transaction.id.startsWith('demo-')).toBe(true)
    }
    for (const rule of ledger.rules) {
      expect(rule.label).toContain('de ejemplo')
    }
    for (const goal of ledger.goals) {
      expect(goal.name).toContain(DEMO_MARK)
    }
    for (const expense of ledger.sharedExpenses) {
      expect(expense.description).toContain(DEMO_MARK)
    }
    expect(ledger.members.map((member) => member.name)).toEqual(['Persona A (demo)', 'Persona B (demo)'])
    // Nobody real is part of the invented household.
    expect(JSON.stringify(ledger)).not.toMatch(/pablo|diego/i)
  })

  it('muestra de todo: saldos, tarjeta pagada sin doble gasto, hogar, metas y algo pendiente', async () => {
    const phone = testPhone('2026-11-10')
    const demo = await phone.open('demo')
    const snapshot = financialSnapshot(toSnapshotInput(await demo.store.ledger(), d('2026-11-10')))

    expect(snapshot.liquidBalance).toBeGreaterThan(0)
    expect(snapshot.totals.expense).toBeGreaterThan(0)
    expect(snapshot.obligations.length).toBeGreaterThan(0)
    expect(snapshot.reservedTotal).toBeGreaterThan(0)
    expect(snapshot.goals.map((goal) => goal.accumulated)).toEqual([150_000, 90_000])
    expect(snapshot.householdBalance).toBe(-5_000)
    expect(await demo.store.ledgerIssues()).toEqual([])
  })

  it('en la Demo, pagar la tarjeta es una transferencia y nunca un segundo gasto', async () => {
    const demo = await testPhone('2026-11-10').open('demo')
    const transactions = await demo.store.transactions()
    const payments = transactions.filter(
      (transaction) => transaction.kind === 'transfer' && transaction.toAccountId === 'demo-tarjeta',
    )
    expect(payments.length).toBeGreaterThanOrEqual(3)
    expect(payments.every((payment) => payment.note === 'Pago de la tarjeta (demo)')).toBe(true)
    expect(
      transactions.some((transaction) => transaction.kind === 'expense' && transaction.note?.includes('Pago de la tarjeta')),
    ).toBe(false)
  })

  it('para cualquier día, los datos de la Demo son válidos y se pueden calcular', () => {
    const profile = profileDescriptor('demo')
    fc.assert(
      fc.property(fc.integer({ min: toEpochDay(d('2026-01-01')), max: toEpochDay(d('2032-12-31')) }), (day) => {
        const today = fromEpochDay(day)
        const snapshot = buildDemoSnapshot(profile, today, '2026-11-10T12:00:00.000Z')
        const report = checkSnapshot(snapshot, today)
        expect(report.problems).toEqual([])
        expect(report.ledgerIssues).toEqual([])
        expect(profileSnapshotSchema.parse(snapshot)).toEqual(snapshot)
        // Nothing invented is dated after «today».
        expect(snapshot.transactions.every((transaction) => transaction.date <= today)).toBe(true)
        const input = toSnapshotInput(snapshot, today)
        expect(financialSnapshot(input).liquidBalance).toBeGreaterThan(0)
        projectScenarios(input, addDays(today, 90))
      }),
    )
  })

  it('los mismos datos para el mismo día', () => {
    const profile = profileDescriptor('demo')
    const build = () => buildDemoSnapshot(profile, d('2026-11-10'), '2026-11-10T12:00:00.000Z')
    expect(build()).toEqual(build())
  })

  it('se reinicia sin tocar los perfiles reales', async () => {
    const phone = testPhone()
    const pablo = await phone.open('pablo')
    await pablo.store.createAccount(account)
    const pabloBefore = await rawContent(phone, 'pablo')

    const demo = await phone.open('demo')
    const pristine = await demo.store.exportSnapshot()
    const { accountId } = await demo.store.createAccount({ ...account, name: 'Cuenta agregada en la demo' })
    await demo.store.recordTransaction({
      kind: 'expense',
      date: d('2026-11-09'),
      amount: clp(1),
      accountId,
      categoryId: cat('ocio'),
    })
    expect(await demo.store.exportSnapshot()).not.toEqual(pristine)

    await resetDemo(demo, phone.env)
    const reset = await demo.store.exportSnapshot()
    // Same invented finances; only the timestamps of the reset differ.
    expect(reset.transactions.map((transaction) => [transaction.id, transaction.amount, transaction.date])).toEqual(
      pristine.transactions.map((transaction) => [transaction.id, transaction.amount, transaction.date]),
    )
    expect(reset.accounts.map((item) => item.id)).toEqual(pristine.accounts.map((item) => item.id))
    expect(await rawContent(phone, 'pablo')).toEqual(pabloBefore)

    expect(await failureOf(resetDemo(pablo, phone.env))).toMatchObject({ code: 'conflict' })
    expect(await rawContent(phone, 'pablo')).toEqual(pabloBefore)
  })

  it('se elimina por completo sin tocar los perfiles reales, y vuelve a nacer si se abre de nuevo', async () => {
    const phone = testPhone()
    const pablo = await phone.open('pablo')
    await pablo.store.createAccount(account)
    const pabloBefore = await rawContent(phone, 'pablo')
    const demo = await phone.open('demo')
    demo.close()

    await deleteDemo(phone.idb)
    const databases = await phone.idb.indexedDB?.databases()
    expect(databases?.map((database) => database.name).sort()).toEqual(['nexo-pablo'])
    expect(await rawContent(phone, 'pablo')).toEqual(pabloBefore)

    const again = await phone.open('demo')
    expect(again.isNew).toBe(true)
    expect((await again.store.transactions()).length).toBeGreaterThan(50)
  })
})

describe('detección de pérdida de datos', () => {
  it('el marcador recuerda cuántos registros había, sin guardar ninguna cifra', async () => {
    const phone = testPhone()
    const session = await phone.open('pablo')
    const { accountId } = await session.store.createAccount(account)
    await session.store.recordTransaction({
      kind: 'expense',
      date: d('2026-11-09'),
      amount: clp(54_321),
      accountId,
      categoryId: cat('supermercado'),
    })

    const note = phone.storage.items.get('nexo.marcador.pablo')
    expect(JSON.parse(note ?? '{}')).toMatchObject({ records: 2, operations: 2 })
    expect(Object.keys(JSON.parse(note ?? '{}') as object).sort()).toEqual(['at', 'operations', 'records'])
    expect(note).not.toContain('54321')
    expect(note).not.toContain('100000')
    expect(session.loss).toBeNull()
  })

  it('si la base aparece vacía y no debería, lo dice y no prepara nada encima', async () => {
    const phone = testPhone()
    const session = await phone.open('pablo')
    await session.store.createAccount(account)
    session.close()

    // The browser threw the database away, but the note in localStorage survived.
    const emptied = { ...phone, idb: testPhone().idb }
    const lost = await testPhoneWith(emptied.idb, phone)
    expect(lost.loss).toMatchObject({ records: 1 })
    expect(lost.isNew).toBe(false)
    expect((await rawContent({ ...phone, idb: emptied.idb })).meta).toEqual([])
    // Nothing can be registered on top of the hole: not an account, not even a preference.
    expect(await failureOf(lost.store.createAccount(account))).toMatchObject({ code: 'not_ready' })
    expect(await failureOf(lost.store.setSetting('humor', 'serio'))).toMatchObject({ code: 'not_ready' })
    expect(await failureOf(lost.store.createGoal({ name: 'Meta de prueba', target: clp(1) }))).toMatchObject({
      code: 'not_ready',
    })
    expect((await rawContent({ ...phone, idb: emptied.idb })).settings).toEqual([])
  })

  it('«restaurar respaldo» resuelve la pérdida', async () => {
    const phone = testPhone()
    const session = await phone.open('pablo')
    await session.store.createAccount(account)
    const before = await rawContent(phone)
    const file = await exportBackup(session, phone.env)
    session.close()

    const emptied = testPhone().idb
    const lost = await testPhoneWith(emptied, phone)
    expect(lost.loss).not.toBeNull()
    await importBackup(lost, file.bytes, phone.env)
    expect(lost.loss).toBeNull()
    expect((await rawContent({ ...phone, idb: emptied })).accounts).toStrictEqual(before.accounts)
  })

  it('después de restaurar, el marcador vuelve a contar lo que hay: una segunda pérdida también se detecta', async () => {
    const phone = testPhone()
    const session = await phone.open('pablo')
    await session.store.createAccount(account)
    await session.store.createAccount({ ...account, name: 'Otra cuenta de prueba' })
    const file = await exportBackup(session, phone.env)
    await session.store.erase()
    // Erased on purpose: the note goes away with the data.
    expect(phone.storage.items.has('nexo.marcador.pablo')).toBe(false)

    await importBackup(session, file.bytes, phone.env)
    expect(JSON.parse(phone.storage.items.get('nexo.marcador.pablo') ?? '{}')).toMatchObject({ records: 2 })
    session.close()

    const lostAgain = await testPhoneWith(testPhone().idb, phone)
    expect(lostAgain.loss).toMatchObject({ records: 2 })
  })

  it('si se vaciaron las tablas pero quedó el perfil, también se detecta, y «empezar de cero» deja de avisar', async () => {
    const phone = testPhone()
    const session = await phone.open('pablo')
    await session.store.createAccount(account)
    session.close()

    // Half a loss: the records are gone, the profile row is still there.
    const { openDatabase } = await import('./dexie/database')
    const raw = await openDatabase('nexo-pablo', phone.idb)
    await raw.accounts.clear()
    raw.close()

    const lost = await phone.open('pablo')
    expect(lost.loss).toMatchObject({ records: 1 })
    await lost.startOver()
    expect(lost.loss).toBeNull()
    lost.close()

    const reopened = await phone.open('pablo')
    expect(reopened.loss).toBeNull()
  })

  it('«empezar de cero» acepta la pérdida y deja de avisar', async () => {
    const phone = testPhone()
    const session = await phone.open('pablo')
    await session.store.createAccount(account)
    session.close()

    const emptied = testPhone().idb
    const lost = await testPhoneWith(emptied, phone)
    await lost.startOver()
    expect(lost.loss).toBeNull()
    expect((await lost.store.categories()).length).toBeGreaterThan(0)
    lost.close()

    const reopened = await testPhoneWith(emptied, phone)
    expect(reopened.loss).toBeNull()
  })

  it('borrar los datos a propósito no es una pérdida', async () => {
    const phone = testPhone()
    const session = await phone.open('pablo')
    await session.store.createAccount(account)
    await session.store.erase()
    session.close()

    const reopened = await phone.open('pablo')
    expect(reopened.loss).toBeNull()
    expect(reopened.isNew).toBe(true)
  })

  it('una instalación nueva, sin marcador, no avisa nada', async () => {
    const session = await testPhone().open('pablo')
    expect(session.loss).toBeNull()
    expect(session.isNew).toBe(true)
  })

  it('si el navegador no deja usar localStorage, todo sigue funcionando sin la detección', async () => {
    const { openProfile } = await import('./session')
    const phone = testPhone()
    const blocked = {
      getItem: () => {
        throw new Error('bloqueado')
      },
      setItem: () => {
        throw new Error('bloqueado')
      },
      removeItem: () => {
        throw new Error('bloqueado')
      },
    }
    const session = await openProfile('pablo', { ...phone.idb, env: phone.env, markerStorage: blocked })
    await session.store.createAccount(account)
    expect(session.loss).toBeNull()
    const none = await openProfile('diego', { ...phone.idb, env: phone.env, markerStorage: null })
    await none.store.createAccount(account)
    expect(none.loss).toBeNull()
  })
})

/** The same phone (same clock, same localStorage) after its IndexedDB was replaced by an empty one. */
async function testPhoneWith(idb: ReturnType<typeof testPhone>['idb'], phone: ReturnType<typeof testPhone>) {
  const { openProfile } = await import('./session')
  return openProfile('pablo', { ...idb, env: phone.env, markerStorage: phone.storage })
}
