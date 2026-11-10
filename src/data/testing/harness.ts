import Dexie from 'dexie'
import fc from 'fast-check'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { type LocalDate, localDate } from '@/domain'
import { type IndexedDbDependencies, openDatabase } from '../dexie/database'
import type { Environment, Instant } from '../environment'
import { toDataError } from '../errors'
import { databaseName } from '../profiles'
import type { ProfileId } from '../records'
import { type ProfileSession, openProfile } from '../session'
import type { KeyValueStorage } from '../storage/loss-marker'

/** A brand-new IndexedDB that lives in memory. Each call is a separate «phone». */
export function memoryIndexedDb(): IndexedDbDependencies {
  const indexedDB = new IDBFactory()
  // Dexie's `liveQuery` does nothing at all where there is no global IndexedDB (Node). It only
  // checks that one exists; every database of the tests still gets its own, passed explicitly.
  if (!Dexie.dependencies.indexedDB) {
    Dexie.dependencies.indexedDB = indexedDB
    Dexie.dependencies.IDBKeyRange = IDBKeyRange
  }
  return { indexedDB, IDBKeyRange }
}

export interface TestEnvironment extends Environment {
  setToday(date: string): void
}

/**
 * A clock and an id generator that always answer the same. Ids are `id-0001`, `id-0002`…; every
 * reading of the clock is one second later than the previous one, starting on `today`.
 */
export function testEnvironment(today = '2026-11-10'): TestEnvironment {
  let day: LocalDate = localDate(today)
  let ids = 0
  let seconds = 0
  return {
    today: () => day,
    now: (): Instant => {
      seconds += 1
      const clock = [Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60]
        .map((part) => String(part).padStart(2, '0'))
        .join(':')
      return `${day}T${clock}.000Z`
    },
    newId: () => {
      ids += 1
      return `id-${String(ids).padStart(4, '0')}`
    },
    setToday: (date: string) => {
      day = localDate(date)
    },
  }
}

/** The reason a promise was rejected, unwrapped the same way the data layer reports it. */
export async function failureOf(promise: PromiseLike<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return toDataError(error)
  }
  throw new Error('Se esperaba un rechazo, pero la operación terminó bien')
}

/** A `localStorage` that lives in memory. */
export function memoryStorage(): KeyValueStorage & { readonly items: Map<string, string> } {
  const items = new Map<string, string>()
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value)
    },
    removeItem: (key) => {
      items.delete(key)
    },
  }
}

export interface TestPhone {
  readonly idb: IndexedDbDependencies
  readonly storage: ReturnType<typeof memoryStorage>
  readonly env: TestEnvironment
  open(id?: ProfileId): Promise<ProfileSession>
}

/** One invented phone: its own IndexedDB, its own `localStorage`, its own clock. */
export function testPhone(today = '2026-11-10'): TestPhone {
  const idb = memoryIndexedDb()
  const storage = memoryStorage()
  const env = testEnvironment(today)
  return {
    idb,
    storage,
    env,
    open: (id = 'pablo') => openProfile(id, { ...idb, env, markerStorage: storage }),
  }
}

/**
 * Every row of every table of a profile, read straight from the database: what «the database is
 * identical» is measured against. Only the `local` table is left out: it holds facts about the
 * device (when it last backed up, which backups it restored), not the person's data.
 */
export async function rawContent(phone: TestPhone, id: ProfileId = 'pablo'): Promise<Record<string, unknown[]>> {
  const db = await openDatabase(databaseName(id), phone.idb)
  try {
    const content: Record<string, unknown[]> = {}
    for (const table of db.tables) {
      if (table.name !== 'local') {
        content[table.name] = await table.toArray()
      }
    }
    return content
  } finally {
    db.close()
  }
}

/** How many random cases a property that needs a database runs: a fraction of the usual number. */
export function databaseRuns(divisor = 2): number {
  const configured = fc.readConfigureGlobal().numRuns ?? 200
  return Math.max(10, Math.ceil(configured / divisor))
}
