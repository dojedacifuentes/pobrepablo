import { describe, expect, it } from 'vitest'
import { DataError } from '../errors'
import type { AuditEntry } from '../records'
import { failureOf, memoryIndexedDb } from '../testing/harness'
import { CURRENT_SCHEMA_VERSION, NexoDatabase, SCHEMA_VERSIONS, type SchemaVersion, openDatabase } from './database'

const entry = (seq: number): AuditEntry => ({
  seq,
  at: '2026-11-10T12:00:00.000Z',
  operation: 'profile.seed',
  changes: [],
})

describe('esquema de la base', () => {
  it('la versión 1 publicada no cambia: un cambio de esquema es siempre una versión nueva', () => {
    expect(SCHEMA_VERSIONS[0]).toEqual({
      version: 1,
      note: 'Esquema inicial',
      stores: {
        meta: 'key',
        accounts: 'id',
        categories: 'id',
        transactions: 'id, date, &occurrenceKey',
        rules: 'id',
        cancelledOccurrences: '[ruleId+dueDate]',
        coverages: '[ruleId+dueDate], &sharedExpenseId',
        budgets: '[categoryId+month], month',
        goals: 'id',
        reservations: 'id, goalId, transferId',
        members: 'id',
        sharedExpenses: 'id, date',
        settlements: 'id, date',
        settings: 'key',
        audit: 'seq, &idempotencyKey',
        local: 'key',
      },
    })
  })

  it('las versiones están numeradas 1, 2, 3… sin saltos', () => {
    expect(SCHEMA_VERSIONS.map((version) => version.version)).toEqual(
      SCHEMA_VERSIONS.map((_, index) => index + 1),
    )
    expect(CURRENT_SCHEMA_VERSION).toBe(SCHEMA_VERSIONS.length)
  })

  it('abre una base nueva con todas sus tablas', async () => {
    const database = await openDatabase('nexo-prueba', memoryIndexedDb())
    expect(database.tables.map((table) => table.name).sort()).toEqual(
      Object.keys(SCHEMA_VERSIONS[0]?.stores ?? {}).sort(),
    )
    expect(database.verno).toBe(CURRENT_SCHEMA_VERSION)
    database.close()
  })
})

describe('migraciones', () => {
  /** A made-up next version, only to prove that the migration machinery keeps the data. */
  const nextVersion: SchemaVersion = {
    version: CURRENT_SCHEMA_VERSION + 1,
    note: 'Prueba: agrega un índice y completa un campo',
    stores: { accounts: 'id, kind' },
    upgrade: async (transaction) => {
      await transaction
        .table<{ name: string }>('accounts')
        .toCollection()
        .modify((account) => {
          account.name = account.name.trim()
        })
    },
  }

  it('una base antigua con datos se actualiza sin perder nada', async () => {
    const phone = memoryIndexedDb()

    const before = await openDatabase('nexo-prueba', phone)
    await before.accounts.bulkAdd([
      {
        id: 'a1' as never,
        name: '  Cuenta de prueba ',
        kind: 'checking',
        openingBalance: 1000 as never,
        openingDate: '2026-01-01' as never,
        archived: false,
        createdAt: '2026-11-10T12:00:00.000Z',
        updatedAt: '2026-11-10T12:00:00.000Z',
      },
    ])
    await before.audit.add(entry(1))
    before.close()

    const after = await openDatabase('nexo-prueba', phone, [...SCHEMA_VERSIONS, nextVersion])
    expect(after.verno).toBe(CURRENT_SCHEMA_VERSION + 1)
    const accounts = await after.accounts.toArray()
    expect(accounts).toHaveLength(1)
    expect(accounts[0]?.name).toBe('Cuenta de prueba')
    expect(accounts[0]?.openingBalance).toBe(1000)
    // The new index works, and what the migration did not touch is still there.
    expect(await after.accounts.where('kind').equals('checking').count()).toBe(1)
    expect(await after.audit.count()).toBe(1)
    after.close()
  })

  it('si la migración falla, la base queda como estaba', async () => {
    const phone = memoryIndexedDb()
    const before = await openDatabase('nexo-prueba', phone)
    await before.audit.add(entry(1))
    before.close()

    const broken: SchemaVersion = {
      ...nextVersion,
      upgrade: () => {
        throw new Error('migración rota a propósito')
      },
    }
    await expect(openDatabase('nexo-prueba', phone, [...SCHEMA_VERSIONS, broken])).rejects.toThrow()

    const reopened = await openDatabase('nexo-prueba', phone)
    expect(reopened.verno).toBe(CURRENT_SCHEMA_VERSION)
    expect(await reopened.audit.count()).toBe(1)
    reopened.close()
  })

  it('una base escrita por una versión más nueva de la app no se abre, y lo explica', async () => {
    const phone = memoryIndexedDb()
    const newer = await openDatabase('nexo-prueba', phone, [...SCHEMA_VERSIONS, nextVersion])
    newer.close()

    const attempt = openDatabase('nexo-prueba', phone)
    await expect(attempt).rejects.toBeInstanceOf(DataError)
    await expect(attempt).rejects.toMatchObject({ code: 'newer_schema' })
  })
})

describe('auditoría de solo agregado', () => {
  it('se puede agregar, pero no modificar ni borrar', async () => {
    const database = await openDatabase('nexo-prueba', memoryIndexedDb())
    await database.audit.add(entry(1))
    await database.audit.bulkAdd([entry(2), entry(3)])

    expect(await failureOf(database.audit.put({ ...entry(1), operation: 'account.create' }))).toMatchObject({ code: 'append_only' })
    expect(await failureOf(database.audit.update(2, { operation: 'account.create' }))).toMatchObject({ code: 'append_only' })
    expect(await failureOf(database.audit.delete(1))).toMatchObject({ code: 'append_only' })
    expect(await failureOf(database.audit.clear())).toMatchObject({ code: 'append_only' })
    expect(await failureOf(database.audit.where('seq').above(1).delete())).toMatchObject({ code: 'append_only' })

    expect((await database.audit.toArray()).map((item) => item.seq)).toEqual([1, 2, 3])
    expect((await database.audit.get(1))?.operation).toBe('profile.seed')
    database.close()
  })

  it('solo una restauración completa puede reemplazarla', async () => {
    const database = await openDatabase('nexo-prueba', memoryIndexedDb())
    await database.audit.add(entry(1))
    await database.rewritingAudit(() => database.audit.clear())
    expect(await database.audit.count()).toBe(0)
    // The door closes again right after.
    await database.audit.add(entry(1))
    expect(await failureOf(database.audit.clear())).toMatchObject({ code: 'append_only' })
    database.close()
  })

  it('una segunda base no comparte datos con la primera', async () => {
    const phone = memoryIndexedDb()
    const first = new NexoDatabase('nexo-uno', phone)
    const second = new NexoDatabase('nexo-dos', phone)
    await first.audit.add(entry(1))
    expect(await second.audit.count()).toBe(0)
    first.close()
    second.close()
  })
})
