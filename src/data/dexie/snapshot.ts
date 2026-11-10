import type { Instant } from '../environment'
import { DataError } from '../errors'
import { sortedByKey } from '../keys'
import type { DeviceState, PersistenceState, RestoreNote } from '../ports'
import { type AuditEntry, DATA_TABLES, type ProfileSnapshot, USER_TABLES } from '../records'
import type { ContentCount } from '../storage/loss-marker'
import type { NexoDatabase } from './database'
import { toTransactionRecord, toTransactionRow } from './rows'
import { LOCAL_LAST_CHANGE } from './unit-of-work'

const LOCAL_LAST_BACKUP = 'lastBackupAt'
/** The last audit entry that the latest backup saved from this device (or restored to it) holds. */
const LOCAL_BACKUP_SEQ = 'lastBackupSeq'
const LOCAL_RESTORES = 'restores'
const LOCAL_PERSISTENCE = 'persistence'

/** A copy that holds exactly what JSON can carry: what is stored is what a backup brings back. */
function plain<T>(rows: readonly T[]): T[] {
  return JSON.parse(JSON.stringify(rows)) as T[]
}

/** How much the profile holds, for the data-loss marker. */
export async function contentCount(db: NexoDatabase): Promise<ContentCount> {
  let records = 0
  for (const table of USER_TABLES) {
    records += await db.table(table).count()
  }
  // The first entry of every trail is the one that prepared the profile.
  return { records, operations: Math.max(0, (await db.audit.count()) - 1) }
}

/** Every row of every table, in the stable order of their keys. Exactly what a backup carries. */
export function readSnapshot(db: NexoDatabase): Promise<ProfileSnapshot> {
  return db.transaction('r', db.tables, async () => {
    const meta = await db.meta.get('profile')
    if (meta === undefined) {
      throw new DataError('not_ready', 'Este perfil todavía no tiene datos: no hay nada que exportar.')
    }
    return {
      meta,
      accounts: sortedByKey('accounts', await db.accounts.toArray()),
      categories: sortedByKey('categories', await db.categories.toArray()),
      transactions: sortedByKey('transactions', (await db.transactions.toArray()).map(toTransactionRecord)),
      rules: sortedByKey('rules', await db.rules.toArray()),
      cancelledOccurrences: sortedByKey('cancelledOccurrences', await db.cancelledOccurrences.toArray()),
      coverages: sortedByKey('coverages', await db.coverages.toArray()),
      budgets: sortedByKey('budgets', await db.budgets.toArray()),
      goals: sortedByKey('goals', await db.goals.toArray()),
      reservations: sortedByKey('reservations', await db.reservations.toArray()),
      members: sortedByKey('members', await db.members.toArray()),
      sharedExpenses: sortedByKey('sharedExpenses', await db.sharedExpenses.toArray()),
      settlements: sortedByKey('settlements', await db.settlements.toArray()),
      settings: sortedByKey('settings', await db.settings.toArray()),
      audit: await db.audit.orderBy('seq').toArray(),
    }
  })
}

async function clearData(db: NexoDatabase): Promise<void> {
  await db.meta.clear()
  for (const table of DATA_TABLES) {
    await db.table(table).clear()
  }
  await db.audit.clear()
}

/**
 * The trace a restore leaves in the audit trail. It is the same every time the same backup is
 * restored (it carries the date of the backup, not the moment of the restore), so that importing
 * a backup twice leaves the very same database. When it happened on this device is kept apart,
 * in the device's own notes.
 */
function restoreEntry(snapshot: ProfileSnapshot, restore: RestoreNote): AuditEntry {
  return {
    seq: (snapshot.audit.at(-1)?.seq ?? 0) + 1,
    at: restore.exportedAt,
    operation: 'profile.restore',
    changes: [],
    result: { exportId: restore.exportId, exportedAt: restore.exportedAt, records: restore.records },
  }
}

/**
 * Swaps the whole content of the profile for the snapshot, inside one transaction: if any row is
 * refused (two movements confirming the same occurrence, a repeated key), nothing changes at all.
 * With a `restore` note, the trail gains the entry that says a backup was restored.
 */
export function writeSnapshot(db: NexoDatabase, snapshot: ProfileSnapshot, restore?: RestoreNote): Promise<ContentCount> {
  const audit = restore === undefined ? snapshot.audit : [...snapshot.audit, restoreEntry(snapshot, restore)]
  return db.rewritingAudit(() =>
    db.transaction('rw', db.tables, async () => {
      await clearData(db)
      await db.meta.add(plain([snapshot.meta])[0] ?? snapshot.meta)
      await db.accounts.bulkAdd(plain(snapshot.accounts))
      await db.categories.bulkAdd(plain(snapshot.categories))
      await db.transactions.bulkAdd(plain(snapshot.transactions).map(toTransactionRow))
      await db.rules.bulkAdd(plain(snapshot.rules))
      await db.cancelledOccurrences.bulkAdd(plain(snapshot.cancelledOccurrences))
      await db.coverages.bulkAdd(plain(snapshot.coverages))
      await db.budgets.bulkAdd(plain(snapshot.budgets))
      await db.goals.bulkAdd(plain(snapshot.goals))
      await db.reservations.bulkAdd(plain(snapshot.reservations))
      await db.members.bulkAdd(plain(snapshot.members))
      await db.sharedExpenses.bulkAdd(plain(snapshot.sharedExpenses))
      await db.settlements.bulkAdd(plain(snapshot.settlements))
      await db.settings.bulkAdd(plain(snapshot.settings))
      await db.audit.bulkAdd(plain(audit))
      if (restore !== undefined) {
        // What this device now holds is what the backup held: nothing is pending to back up.
        const restores = (await readDeviceState(db)).restores
        await db.local.bulkPut([
          { key: LOCAL_RESTORES, value: [...restores, restore].map((note) => ({ ...note })) },
          { key: LOCAL_BACKUP_SEQ, value: audit.at(-1)?.seq ?? 0 },
          { key: LOCAL_LAST_BACKUP, value: restore.exportedAt },
        ])
      }
      return contentCount(db)
    }),
  )
}

/** Deletes every record of the profile and what this device remembered about it. */
export function eraseAll(db: NexoDatabase): Promise<void> {
  return db.rewritingAudit(() =>
    db.transaction('rw', db.tables, async () => {
      await clearData(db)
      await db.local.clear()
    }),
  )
}

function isRestoreNote(value: unknown): value is RestoreNote {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const note = value as Record<string, unknown>
  return (
    typeof note.at === 'string' &&
    typeof note.exportId === 'string' &&
    typeof note.exportedAt === 'string' &&
    typeof note.records === 'number'
  )
}

const PERSISTENCE_STATES: readonly PersistenceState[] = ['persisted', 'best_effort', 'unsupported', 'failed']

export function readDeviceState(db: NexoDatabase): Promise<DeviceState> {
  return db.transaction('r', [db.local, db.audit], async () => {
    const rows = new Map((await db.local.toArray()).map((row) => [row.key, row.value]))
    const text = (key: string): Instant | null => {
      const value = rows.get(key)
      return typeof value === 'string' ? value : null
    }
    const restores = rows.get(LOCAL_RESTORES)
    const persistence = rows.get(LOCAL_PERSISTENCE)
    let stored: DeviceState['persistence'] = null
    if (typeof persistence === 'object' && persistence !== null && !Array.isArray(persistence)) {
      const { state, at } = persistence
      const known = PERSISTENCE_STATES.find((candidate) => candidate === state)
      if (known !== undefined && typeof at === 'string') {
        stored = { state: known, at }
      }
    }
    // Counted from the trail itself, not from a counter that a backup could reset by mistake: every
    // operation stored after the last entry the backup holds is a change that is not backed up.
    const backedUp = rows.get(LOCAL_BACKUP_SEQ)
    const baseline = typeof backedUp === 'number' ? backedUp : ((await db.audit.orderBy('seq').first())?.seq ?? 0)
    return {
      changesSinceBackup: await db.audit.where('seq').above(baseline).count(),
      lastChangeAt: text(LOCAL_LAST_CHANGE),
      lastBackupAt: text(LOCAL_LAST_BACKUP),
      restores: Array.isArray(restores) ? (restores as unknown[]).filter(isRestoreNote) : [],
      persistence: stored,
    }
  })
}

/** A backup that holds the trail up to `throughSeq` was saved outside the phone. */
export async function noteBackupSaved(db: NexoDatabase, at: Instant, throughSeq: number): Promise<void> {
  await db.local.bulkPut([
    { key: LOCAL_LAST_BACKUP, value: at },
    { key: LOCAL_BACKUP_SEQ, value: throughSeq },
  ])
}

export async function notePersistence(db: NexoDatabase, state: PersistenceState, at: Instant): Promise<void> {
  await db.local.put({ key: LOCAL_PERSISTENCE, value: { state, at } })
}
