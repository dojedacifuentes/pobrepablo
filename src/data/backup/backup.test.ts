import { describe, expect, it } from 'vitest'
import { type AccountId, equalShares, toId } from '@/domain'
import { DIEGO, MEMBERS, cat, clp, d } from '@/domain/testing/builders'
import { DATA_MODEL_VERSION, type ProfileSnapshot } from '../records'
import { type TestPhone, rawContent, testPhone } from '../testing/harness'
import {
  BACKUP_MIGRATIONS,
  type BackupFile,
  exportBackup,
  importBackup,
  noteBackupSaved,
  readBackup,
  upgradeData,
} from './backup'
import { canonicalJson, sha256Hex } from './canonical'
import { MIN_ITERATIONS } from './crypto'
import { CURRENT_SCHEMA_VERSION } from '../dexie/database'

const PHRASE = 'frase de prueba larga'
const CHECKING: AccountId = toId('corriente')
const TODAY = d('2026-11-10')

const failure = async (promise: Promise<unknown>): Promise<unknown> => promise.then(() => null, (error: unknown) => error)

/** A profile with a bit of everything: accounts, movements (one voided), a rule, a goal, the household. */
async function populated(phone: TestPhone = testPhone('2026-11-10')) {
  const session = await phone.open('pablo')
  const { store } = session
  await store.createAccount({
    id: CHECKING,
    name: 'Cuenta de prueba',
    kind: 'checking',
    openingBalance: clp(700_000),
    openingDate: d('2026-10-01'),
  })
  await store.createAccount({
    id: toId('tarjeta'),
    name: 'Tarjeta de prueba',
    kind: 'credit_card',
    openingBalance: clp(0),
    openingDate: d('2026-10-01'),
    paymentDay: 5,
    statementDay: 20,
  })
  const groceries = { kind: 'expense', date: d('2026-11-03'), amount: clp(42_000), accountId: CHECKING, categoryId: cat('supermercado') } as const
  await store.recordTransaction(groceries, { idempotencyKey: 'formulario-a' })
  const { transactionId } = await store.recordTransaction({ ...groceries, amount: clp(9_990), note: 'Se anula' })
  await store.voidTransaction(transactionId)
  const { ruleId } = await store.createRule({
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
  await store.confirmOccurrence({ ref: { ruleId, dueDate: d('2026-10-05') }, date: d('2026-10-05') })
  await store.skipOccurrence({ ruleId, dueDate: d('2026-11-05') })
  await store.setBudget({ categoryId: cat('supermercado'), month: '2026-11' as never, planned: clp(200_000), funded: true })
  const { goalId } = await store.createGoal({ name: 'Meta de prueba', target: clp(500_000) })
  await store.reserveForGoal({ goalId, amount: clp(50_000), date: d('2026-11-01') })
  await store.recordSharedExpense({
    date: d('2026-11-06'),
    description: 'Gasto común de prueba',
    categoryId: cat('luz'),
    total: clp(30_001),
    payerId: DIEGO,
    shares: equalShares(MEMBERS),
  })
  await store.setSetting('humor', 'serio')
  return { phone, session, store }
}

/**
 * What a database must hold after restoring `file` over `before`: exactly the same, plus the one
 * audit entry that says the backup was restored. The entry carries the date of the backup, so it
 * is the same no matter when or how many times the backup is restored.
 */
function withRestore(before: Record<string, unknown[]>, file: BackupFile): Record<string, unknown[]> {
  return {
    ...before,
    audit: [
      ...(before.audit ?? []),
      {
        seq: file.throughSeq + 1,
        at: file.exportedAt,
        operation: 'profile.restore',
        changes: [],
        result: { exportId: file.exportId, exportedAt: file.exportedAt, records: file.records },
      },
    ],
  }
}

function decode(file: BackupFile): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(file.bytes)) as Record<string, unknown>
}

function encode(envelope: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(envelope))
}

/** The same backup with its data changed and its checksum recomputed: a well-sealed lie. */
async function resealed(file: BackupFile, change: (data: ProfileSnapshot) => void): Promise<Uint8Array> {
  const envelope = decode(file)
  change(envelope.data as ProfileSnapshot)
  envelope.checksum = await sha256Hex(canonicalJson(envelope.data))
  return encode(envelope)
}

describe('ida y vuelta: exportar → borrar → importar deja la base idéntica', () => {
  it('sin cifrar', async () => {
    const { phone, session, store } = await populated()
    const before = await rawContent(phone)
    const file = await exportBackup(session, phone.env)

    expect(file.encrypted).toBe(false)
    expect(file.fileName).toBe('nexo-pablo-2026-11-10.nexo.json')
    expect(file.problems).toEqual([])

    await store.erase()
    expect((await rawContent(phone)).transactions).toEqual([])
    expect((await rawContent(phone)).audit).toEqual([])

    const result = await importBackup(session, file.bytes, phone.env)
    expect(result.records).toBe(file.records)
    expect(await rawContent(phone)).toStrictEqual(withRestore(before, file))
  })

  it('cifrado', async () => {
    const { phone, session, store } = await populated()
    const before = await rawContent(phone)
    const file = await exportBackup(session, phone.env, { passphrase: PHRASE, repeatedPassphrase: PHRASE }, MIN_ITERATIONS)

    expect(file.encrypted).toBe(true)
    expect(file.fileName).toBe('nexo-pablo-2026-11-10.nexo.enc')
    expect(new TextDecoder('latin1').decode(file.bytes)).not.toContain('Arriendo')

    await store.erase()
    await importBackup(session, file.bytes, phone.env, { passphrase: PHRASE })
    expect(await rawContent(phone)).toStrictEqual(withRestore(before, file))
  })

  it('en otro teléfono, recién instalado: queda igual que el original', async () => {
    const { phone, session } = await populated()
    const original = await rawContent(phone)
    const file = await exportBackup(session, phone.env, { passphrase: PHRASE }, MIN_ITERATIONS)

    const newPhone = testPhone('2026-11-12')
    const fresh = await newPhone.open('pablo')
    await importBackup(fresh, file.bytes, newPhone.env, { passphrase: PHRASE })
    expect(await rawContent(newPhone)).toStrictEqual(withRestore(original, file))
    // And it keeps working: the index that stops a double confirmation was rebuilt.
    const [rule] = await fresh.store.rules()
    if (rule === undefined) {
      throw new Error('falta el recurrente')
    }
    await expect(
      fresh.store.confirmOccurrence({ ref: { ruleId: rule.id, dueDate: d('2026-10-05') }, date: d('2026-10-05') }),
    ).rejects.toThrow('ya fue confirmado')
  })

  it('importar dos veces el mismo respaldo deja la base idéntica', async () => {
    const { phone, session, store } = await populated()
    const file = await exportBackup(session, phone.env)
    await importBackup(session, file.bytes, phone.env)
    const once = await rawContent(phone)

    await importBackup(session, file.bytes, phone.env)
    expect(await rawContent(phone)).toStrictEqual(once)

    // Also after something else was registered in between: the backup is what stays.
    await store.recordTransaction({ kind: 'income', date: TODAY, amount: clp(5_000), accountId: CHECKING, categoryId: cat('sueldo') })
    await importBackup(session, file.bytes, phone.env)
    expect(await rawContent(phone)).toStrictEqual(once)

    // The device remembers that it restored three times; that is not part of the person's data.
    expect((await store.deviceState()).restores.map((note) => note.exportId)).toEqual([
      file.exportId,
      file.exportId,
      file.exportId,
    ])
  })

  it('dos exportaciones de los mismos datos traen el mismo contenido', async () => {
    const { phone, session } = await populated()
    const first = decode(await exportBackup(session, phone.env))
    const second = decode(await exportBackup(session, phone.env))
    expect(second.checksum).toBe(first.checksum)
    expect(second.data).toEqual(first.data)
    expect(second.exportId).not.toBe(first.exportId)
  })

  it('el sobre dice qué es, de quién y con qué versión se escribió', async () => {
    const { phone, session } = await populated()
    const envelope = decode(await exportBackup(session, phone.env))
    expect(envelope).toMatchObject({
      app: 'nexo',
      format: 'respaldo',
      formatVersion: 1,
      schemaVersion: DATA_MODEL_VERSION,
      profile: { id: 'pablo', kind: 'personal', name: 'Pablo' },
    })
    expect(envelope.counts).toMatchObject({ accounts: 2, transactions: 3, rules: 1, goals: 1, sharedExpenses: 1 })
    // The index field that only the database needs does not travel.
    expect(JSON.stringify(envelope.data)).not.toContain('occurrenceKey')
  })

  it('la versión del modelo de datos acompaña a la del esquema de la base', () => {
    expect(DATA_MODEL_VERSION).toBe(CURRENT_SCHEMA_VERSION)
    for (let version = 1; version < DATA_MODEL_VERSION; version += 1) {
      expect(BACKUP_MIGRATIONS[version], `falta la conversión del respaldo de la versión ${String(version)}`).toBeTypeOf('function')
    }
  })
})

describe('exportar', () => {
  it('los cambios pendientes se cuentan desde lo que el respaldo guardado contiene', async () => {
    const { phone, session, store } = await populated()
    const pending = (await store.deviceState()).changesSinceBackup
    expect(pending).toBeGreaterThan(5)
    expect((await store.deviceState()).lastBackupAt).toBeNull()

    // Writing the file changes nothing yet: the person has not saved it anywhere.
    const file = await exportBackup(session, phone.env)
    expect(await store.deviceState()).toMatchObject({ changesSinceBackup: pending, lastBackupAt: null })

    // Something is registered while the file is being saved: it is not inside the file.
    await store.setSetting('humor', 'narrativo')
    expect(await noteBackupSaved(session, file)).toBe(true)
    expect(await store.deviceState()).toMatchObject({ changesSinceBackup: 1, lastBackupAt: file.exportedAt })

    await store.setSetting('humor', 'discreto')
    expect((await store.deviceState()).changesSinceBackup).toBe(2)
  })

  it('después de restaurar no queda nada pendiente de respaldar', async () => {
    const { phone, session, store } = await populated()
    const file = await exportBackup(session, phone.env)
    await importBackup(session, file.bytes, phone.env)
    expect(await store.deviceState()).toMatchObject({ changesSinceBackup: 0, lastBackupAt: file.exportedAt })
  })

  it('no cifra con una frase corta o mal repetida', async () => {
    const { phone, session } = await populated()
    expect(await failure(exportBackup(session, phone.env, { passphrase: 'corta' }))).toMatchObject({ code: 'weak_passphrase' })
    expect(
      await failure(exportBackup(session, phone.env, { passphrase: PHRASE, repeatedPassphrase: `${PHRASE}.` })),
    ).toMatchObject({ code: 'weak_passphrase' })
  })
})

describe('importar: lo que se rechaza', () => {
  it('un respaldo cifrado sin frase, o con otra frase', async () => {
    const { phone, session } = await populated()
    const before = await rawContent(phone)
    const file = await exportBackup(session, phone.env, { passphrase: PHRASE }, MIN_ITERATIONS)
    expect(await failure(importBackup(session, file.bytes, phone.env))).toMatchObject({ code: 'passphrase_required' })
    expect(await failure(importBackup(session, file.bytes, phone.env, { passphrase: 'otra frase larga' }))).toMatchObject({
      code: 'wrong_passphrase',
    })
    expect(await rawContent(phone)).toEqual(before)
  })

  it('un archivo que no es un respaldo', async () => {
    const { phone, session } = await populated()
    for (const content of ['hola', '{"app":"otra"}', '[1,2,3]', '']) {
      expect(await failure(importBackup(session, new TextEncoder().encode(content), phone.env))).toMatchObject({
        code: 'not_a_backup',
      })
    }
    expect(await failure(importBackup(session, new Uint8Array([0xff, 0xfe, 0xfd]), phone.env))).toMatchObject({
      code: 'not_a_backup',
    })
  })

  it('un respaldo cortado o con el contenido alterado', async () => {
    const { phone, session } = await populated()
    const file = await exportBackup(session, phone.env)
    const cut = file.bytes.slice(0, file.bytes.length - 40)
    expect(await failure(importBackup(session, cut, phone.env))).toMatchObject({ code: 'corrupted' })
    expect(await failure(importBackup(session, file.bytes.slice(0, 200), phone.env))).toMatchObject({ code: 'corrupted' })

    const envelope = decode(file)
    const data = envelope.data as ProfileSnapshot
    ;(data.accounts[0] as { openingBalance: number }).openingBalance = 999_999_999
    expect(await failure(importBackup(session, encode(envelope), phone.env))).toMatchObject({ code: 'corrupted' })
  })

  it('un respaldo de una versión más nueva de la app', async () => {
    const { phone, session } = await populated()
    const envelope = decode(await exportBackup(session, phone.env))
    expect(
      await failure(importBackup(session, encode({ ...envelope, schemaVersion: DATA_MODEL_VERSION + 1 }), phone.env)),
    ).toMatchObject({ code: 'unsupported_version' })
    expect(await failure(importBackup(session, encode({ ...envelope, formatVersion: 2 }), phone.env))).toMatchObject({
      code: 'unsupported_version',
    })
  })

  it('datos con forma inválida, aunque el sello esté bien: decimales, campos desconocidos, fechas imposibles', async () => {
    const { phone, session } = await populated()
    const before = await rawContent(phone)
    const file = await exportBackup(session, phone.env)
    const lies: ((data: ProfileSnapshot) => void)[] = [
      (data) => ((data.transactions[0] as { amount: number }).amount = 100.5),
      (data) => ((data.transactions[0] as { extra?: boolean }).extra = true),
      (data) => ((data.transactions[0] as { date: string }).date = '2026-02-30'),
      (data) => ((data.accounts[0] as { kind: string }).kind = 'cripto'),
      (data) => ((data as { tablaNueva?: unknown[] }).tablaNueva = []),
    ]
    for (const lie of lies) {
      const failed = await failure(importBackup(session, await resealed(file, lie), phone.env))
      expect(failed).toMatchObject({ code: 'invalid_content' })
      expect((failed as { problems: string[] }).problems.length).toBeGreaterThan(0)
    }
    expect(await rawContent(phone)).toEqual(before)
  })

  it('datos que se contradicen: una cuenta que no existe, un programado confirmado dos veces', async () => {
    const { phone, session } = await populated()
    const before = await rawContent(phone)
    const file = await exportBackup(session, phone.env)

    const orphan = await failure(
      importBackup(
        session,
        await resealed(file, (data) => ((data.transactions[0] as { accountId: string }).accountId = 'no-existe')),
        phone.env,
      ),
    )
    expect(orphan).toMatchObject({ code: 'invalid_content' })
    expect((orphan as { problems: string[] }).problems[0]).toContain('La cuenta no existe')

    const twice = await failure(
      importBackup(
        session,
        await resealed(file, (data) => {
          const confirmation = data.transactions.find((transaction) => 'occurrence' in transaction)
          ;(data.transactions as unknown[]).push({ ...confirmation, id: 'copia' })
        }),
        phone.env,
      ),
    )
    expect(twice).toMatchObject({ code: 'invalid_content' })
    expect((twice as { problems: string[] }).problems.join(' ')).toContain('confirmado dos veces')
    expect(await rawContent(phone)).toEqual(before)
  })

  it('el respaldo de otro perfil', async () => {
    const { phone, session } = await populated()
    const file = await exportBackup(session, phone.env)
    const diego = await phone.open('diego')
    const failed = await failure(importBackup(diego, file.bytes, phone.env))
    expect(failed).toMatchObject({ code: 'wrong_profile' })
    expect((failed as Error).message).toContain('Pablo')
    expect(await diego.store.accounts()).toEqual([])
  })

  it('las cifras inventadas de la Demo no entran a un perfil real, ni las reales a la Demo', async () => {
    const { phone, session } = await populated()
    const real = await exportBackup(session, phone.env)
    const demo = await phone.open('demo')
    const invented = await exportBackup(demo, phone.env)
    const before = await rawContent(phone)

    const intoReal = await failure(importBackup(session, invented.bytes, phone.env))
    expect(intoReal).toMatchObject({ code: 'wrong_profile' })
    expect((intoReal as Error).message).toContain('inventadas')
    expect(await failure(importBackup(demo, real.bytes, phone.env))).toMatchObject({ code: 'wrong_profile' })
    expect(await rawContent(phone)).toEqual(before)

    // The Demo does restore its own backup.
    await importBackup(demo, invented.bytes, phone.env)
  })
})

describe('importar: lo que se avisa sin rechazar', () => {
  it('un registro del hogar sin su contraparte se informa a la persona', async () => {
    const { phone, session } = await populated()
    const file = await exportBackup(session, phone.env)
    // Somebody edited the file: Pablo now appears as who paid, with no cash movement behind it.
    const altered = await resealed(file, (data) => {
      ;(data.sharedExpenses[0] as { payerId: string }).payerId = 'pablo'
    })
    const result = await importBackup(session, altered, phone.env)
    expect(result.problems).toEqual([])
    expect(result.ledgerIssues).toMatchObject([{ kind: 'expense_without_payment' }])
    expect(await session.store.ledgerIssues()).toMatchObject([{ kind: 'expense_without_payment' }])
  })

  it('rescate: un respaldo que se contradice se puede restaurar solo si se pide expresamente', async () => {
    const { phone, session } = await populated()
    await session.store.setBudget({ categoryId: cat('ocio'), month: '2026-08' as never, planned: clp(10_000), funded: false })
    const file = await exportBackup(session, phone.env)
    // A budget of another month with a negative plan breaks a rule, but no calculation of today.
    const altered = await resealed(file, (data) => {
      const past = data.budgets.find((budget) => budget.month === ('2026-08' as never))
      ;(past as unknown as { planned: number }).planned = -1
    })
    expect(await failure(importBackup(session, altered, phone.env))).toMatchObject({ code: 'invalid_content' })
    const rescued = await importBackup(session, altered, phone.env, { acceptProblems: true })
    expect(rescued.problems).toHaveLength(1)
    expect(rescued.problems[0]).toContain('no puede ser negativo')
    expect((await session.store.budgets('2026-08' as never))[0]?.planned).toBe(-1)
  })

  it('leer un respaldo no guarda nada', async () => {
    const { phone, session } = await populated()
    const file = await exportBackup(session, phone.env)
    const before = await rawContent(phone)
    const read = await readBackup(file.bytes, TODAY)
    expect(read.snapshot.meta.id).toBe('pablo')
    expect(read.ledgerIssues).toEqual([])
    expect(await rawContent(phone)).toEqual(before)
  })

  it('un movimiento con fecha futura (un reloj mal puesto) se acepta y no cuenta todavía', async () => {
    const { phone, session } = await populated()
    const file = await exportBackup(session, phone.env)
    const altered = await resealed(file, (data) => {
      ;(data.transactions[0] as { date: string }).date = '2027-01-15'
    })
    const result = await importBackup(session, altered, phone.env)
    expect(result.problems).toEqual([])
  })
})

describe('respaldos de versiones anteriores', () => {
  // There is only one version of the data so far, so no real old backup exists. This proves the
  // machinery that will convert them, with made-up steps.
  const steps = {
    1: (data: unknown) => ({ ...(data as object), pasoUno: true }),
    2: (data: unknown) => ({ ...(data as object), pasoDos: Object.keys(data as object).length }),
  }

  it('aplica en orden cada conversión desde la versión del archivo hasta la actual', () => {
    expect(upgradeData({ dato: 1 }, 1, 3, steps)).toEqual({ dato: 1, pasoUno: true, pasoDos: 2 })
    expect(upgradeData({ dato: 1 }, 2, 3, steps)).toEqual({ dato: 1, pasoDos: 1 })
    expect(upgradeData({ dato: 1 }, 3, 3, steps)).toEqual({ dato: 1 })
  })

  it('si falta una conversión, se detiene y lo explica en vez de adivinar', () => {
    expect(() => upgradeData({ dato: 1 }, 1, 4, steps)).toThrow('ya no sabe convertir')
  })
})
