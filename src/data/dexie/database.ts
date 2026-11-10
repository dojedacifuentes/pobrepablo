import Dexie, { type DBCore, type DBCoreMutateRequest, type Table, type Transaction as DexieTransaction } from 'dexie'
import { DataError, toDataError } from '../errors'
import type {
  AccountRecord,
  AuditEntry,
  BudgetRecord,
  CancelledOccurrenceRecord,
  CategoryRecord,
  CoverageRecord,
  GoalRecord,
  JsonValue,
  MemberRecord,
  ProfileInfo,
  ReservationRecord,
  RuleRecord,
  SettingRecord,
  SettlementRecord,
  SharedExpenseRecord,
  TransactionRecord,
} from '../records'

/**
 * A movement as it sits in the table. `occurrenceKey` exists only while the movement is live and
 * confirms a programmed occurrence; the table has a unique index on it, so two movements can never
 * confirm the same occurrence, not even when two writes race. It is derived, never exported.
 */
export type TransactionRow = TransactionRecord & { readonly occurrenceKey?: string }

/** Facts about this device, not about the person's finances. They never travel in a backup. */
export interface LocalRecord {
  readonly key: string
  readonly value: JsonValue
}

export interface SchemaVersion {
  readonly version: number
  /** What changed, in one line. */
  readonly note: string
  /** Dexie store definitions: primary key first, then indexes. `null` deletes a table. */
  readonly stores: Readonly<Record<string, string | null>>
  /** Moves the data written by the previous version into the new shape. */
  readonly upgrade?: (transaction: DexieTransaction) => Promise<void> | void
}

/**
 * The history of the database schema.
 *
 * A published version is never edited: every change is a new entry with the next number, additive
 * whenever possible, and with a test that opens a database of the previous version full of data.
 * `schema.test.ts` pins the text of each published version to make an accidental edit fail.
 */
export const SCHEMA_VERSIONS: readonly SchemaVersion[] = [
  {
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
  },
]

export const CURRENT_SCHEMA_VERSION = SCHEMA_VERSIONS.reduce((latest, entry) => Math.max(latest, entry.version), 0)

/** IndexedDB itself. Injected in tests; the browser's own by default. */
export interface IndexedDbDependencies {
  readonly indexedDB?: IDBFactory
  readonly IDBKeyRange?: typeof IDBKeyRange
}

const AUDIT_TABLE = 'audit'

function describeMutation(request: DBCoreMutateRequest): string {
  switch (request.type) {
    case 'add':
      return 'agregar'
    case 'put':
      return 'modificar'
    case 'delete':
    case 'deleteRange':
      return 'borrar'
  }
}

export class NexoDatabase extends Dexie {
  declare readonly meta: Table<ProfileInfo, string>
  declare readonly accounts: Table<AccountRecord, string>
  declare readonly categories: Table<CategoryRecord, string>
  declare readonly transactions: Table<TransactionRow, string>
  declare readonly rules: Table<RuleRecord, string>
  declare readonly cancelledOccurrences: Table<CancelledOccurrenceRecord, [string, string]>
  declare readonly coverages: Table<CoverageRecord, [string, string]>
  declare readonly budgets: Table<BudgetRecord, [string, string]>
  declare readonly goals: Table<GoalRecord, string>
  declare readonly reservations: Table<ReservationRecord, string>
  declare readonly members: Table<MemberRecord, string>
  declare readonly sharedExpenses: Table<SharedExpenseRecord, string>
  declare readonly settlements: Table<SettlementRecord, string>
  declare readonly settings: Table<SettingRecord, string>
  declare readonly audit: Table<AuditEntry, number>
  declare readonly local: Table<LocalRecord, string>

  /** Above zero only while a whole-profile restore or erase is running. */
  private auditRewrites = 0

  constructor(
    name: string,
    dependencies: IndexedDbDependencies = {},
    versions: readonly SchemaVersion[] = SCHEMA_VERSIONS,
  ) {
    super(name, {
      ...(dependencies.indexedDB !== undefined ? { indexedDB: dependencies.indexedDB } : {}),
      ...(dependencies.IDBKeyRange !== undefined ? { IDBKeyRange: dependencies.IDBKeyRange } : {}),
    })
    for (const entry of versions) {
      const definition = this.version(entry.version).stores({ ...entry.stores })
      if (entry.upgrade !== undefined) {
        definition.upgrade(entry.upgrade)
      }
    }
    this.use({
      stack: 'dbcore',
      name: 'nexo-append-only-audit',
      create: (down: DBCore): Partial<DBCore> => ({
        table: (tableName: string) => {
          const table = down.table(tableName)
          if (tableName !== AUDIT_TABLE) {
            return table
          }
          return {
            ...table,
            mutate: (request: DBCoreMutateRequest) => {
              if (request.type !== 'add' && this.auditRewrites === 0) {
                return Promise.reject(
                  new DataError(
                    'append_only',
                    `El registro de auditoría solo crece: no se puede ${describeMutation(request)} una entrada.`,
                  ),
                )
              }
              return table.mutate(request)
            },
          }
        },
      }),
    })
  }

  /**
   * Runs a whole-profile replacement: the only moment in which the audit trail may be emptied,
   * because it is being swapped for the trail that comes inside a backup (or erased on request).
   */
  async rewritingAudit<T>(work: () => Promise<T>): Promise<T> {
    this.auditRewrites += 1
    try {
      return await work()
    } finally {
      this.auditRewrites -= 1
    }
  }
}

/**
 * The native version of a database, read with plain IndexedDB, or `null` when it does not exist.
 * Opening without a version never upgrades; if the database is missing, the creation is aborted,
 * so that asking the question leaves no trace.
 */
function storedVersion(name: string, factory: IDBFactory | undefined): Promise<number | null> {
  const indexedDb = factory ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB
  if (indexedDb === undefined) {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    let missing = false
    const request = indexedDb.open(name)
    request.onupgradeneeded = () => {
      missing = true
      request.transaction?.abort()
    }
    request.onsuccess = () => {
      const { version } = request.result
      request.result.close()
      resolve(missing ? null : version)
    }
    // An aborted creation ends here. Any other failure is left for Dexie to report properly.
    request.onerror = (event) => {
      event.preventDefault()
      resolve(null)
    }
    request.onblocked = () => resolve(null)
  })
}

/** Opens (and, the first time, creates or upgrades) the database. Errors come back explained. */
export async function openDatabase(
  name: string,
  dependencies: IndexedDbDependencies = {},
  versions: readonly SchemaVersion[] = SCHEMA_VERSIONS,
): Promise<NexoDatabase> {
  // Dexie opens a database that is newer than the code without complaining, and may even add
  // back the tables or indexes the newer version removed. So an outdated app looks at the version
  // first, without Dexie, and refuses before anything can be touched.
  const declared = versions.reduce((latest, entry) => Math.max(latest, entry.version), 0)
  const stored = await storedVersion(name, dependencies.indexedDB)
  if (stored !== null && Math.round(stored / 10) > declared) {
    throw new DataError(
      'newer_schema',
      'Estos datos los guardó una versión más nueva de la app. Actualiza la app antes de abrirlos.',
    )
  }
  const database = new NexoDatabase(name, dependencies, versions)
  try {
    await database.open()
  } catch (error) {
    database.close()
    throw toDataError(error)
  }
  return database
}
