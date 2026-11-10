import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { d } from '@/domain/testing/builders'
import { profileSnapshotSchema } from '../schemas'
import { arbProfileSnapshot } from '../testing/arbitraries'
import { databaseRuns, rawContent, testPhone } from '../testing/harness'
import { type BackupFile, exportBackup, importBackup } from './backup'
import { MIN_ITERATIONS } from './crypto'
import { checkSnapshot } from './integrity'

/**
 * The database after a restore, minus the one audit entry that says the backup was restored. The
 * entry must be exactly the expected one, and the last of the trail.
 */
function withoutRestore(content: Record<string, unknown[]>, file: BackupFile): Record<string, unknown[]> {
  const audit = content.audit ?? []
  expect(audit.at(-1)).toStrictEqual({
    seq: file.throughSeq + 1,
    at: file.exportedAt,
    operation: 'profile.restore',
    changes: [],
    result: { exportId: file.exportId, exportedAt: file.exportedAt, records: file.records },
  })
  return { ...content, audit: audit.slice(0, -1) }
}

const TODAY = '2026-11-10'
const PHRASE = 'frase de prueba larga'

/**
 * These properties run against a real (in-memory) IndexedDB, so each case is slower than a pure
 * one: they run a fraction of the usual number of cases. NEXO_PROPERTY_RUNS scales them too.
 */
const SLOW = { timeout: 300_000 }

describe('invariante: importar el mismo respaldo dos veces deja la base idéntica', () => {
  it('los perfiles aleatorios de las pruebas son válidos y calzan con el esquema', () => {
    fc.assert(
      fc.property(arbProfileSnapshot, (snapshot) => {
        expect(checkSnapshot(snapshot, d(TODAY)).problems).toEqual([])
        expect(profileSnapshotSchema.parse(snapshot)).toEqual(snapshot)
      }),
    )
  })

  it(
    'para cualquier perfil: importar una vez, dos veces, o después de otros cambios, da la misma base',
    SLOW,
    async () => {
      await fc.assert(
        fc.asyncProperty(arbProfileSnapshot, arbProfileSnapshot, async (snapshot, other) => {
          const source = testPhone(TODAY)
          const origin = await source.open(snapshot.meta.id)
          await origin.store.replaceWith(snapshot)
          const file = await exportBackup(origin, source.env)
          origin.close()

          const phone = testPhone(TODAY)
          const session = await phone.open(snapshot.meta.id)
          await importBackup(session, file.bytes, phone.env)
          const once = await rawContent(phone, snapshot.meta.id)

          await importBackup(session, file.bytes, phone.env)
          expect(await rawContent(phone, snapshot.meta.id)).toStrictEqual(once)

          // Whatever the profile held in between, the same backup brings back the same database.
          await session.store.replaceWith({ ...other, meta: snapshot.meta, members: snapshot.members })
          await importBackup(session, file.bytes, phone.env)
          expect(await rawContent(phone, snapshot.meta.id)).toStrictEqual(once)
          session.close()
        }),
        { numRuns: databaseRuns() },
      )
    },
  )

  it(
    'para cualquier perfil: exportar → borrar → importar deja la base idéntica, más la constancia de la restauración',
    SLOW,
    async () => {
      await fc.assert(
        fc.asyncProperty(arbProfileSnapshot, async (snapshot) => {
          const phone = testPhone(TODAY)
          const session = await phone.open(snapshot.meta.id)
          await session.store.replaceWith(snapshot)
          const before = await rawContent(phone, snapshot.meta.id)

          const file = await exportBackup(session, phone.env)
          expect(file.problems).toEqual([])
          await session.store.erase()
          await importBackup(session, file.bytes, phone.env)

          expect(withoutRestore(await rawContent(phone, snapshot.meta.id), file)).toStrictEqual(before)
          session.close()
        }),
        { numRuns: databaseRuns() },
      )
    },
  )

  it(
    'lo mismo con el respaldo cifrado',
    SLOW,
    async () => {
      await fc.assert(
        fc.asyncProperty(arbProfileSnapshot, async (snapshot) => {
          const phone = testPhone(TODAY)
          const session = await phone.open(snapshot.meta.id)
          await session.store.replaceWith(snapshot)
          const before = await rawContent(phone, snapshot.meta.id)

          const file = await exportBackup(session, phone.env, { passphrase: PHRASE }, MIN_ITERATIONS)
          await session.store.erase()
          await importBackup(session, file.bytes, phone.env, { passphrase: PHRASE })
          const once = await rawContent(phone, snapshot.meta.id)
          expect(withoutRestore(once, file)).toStrictEqual(before)

          await importBackup(session, file.bytes, phone.env, { passphrase: PHRASE })
          expect(await rawContent(phone, snapshot.meta.id)).toStrictEqual(once)
          session.close()
        }),
        { numRuns: databaseRuns(8) },
      )
    },
  )
})
