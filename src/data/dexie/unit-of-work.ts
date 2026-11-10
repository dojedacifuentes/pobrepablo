import type { LedgerIssue, LocalDate } from '@/domain'
import type { Environment, Instant } from '../environment'
import { DataError, isExplained, toDataError } from '../errors'
import { describeLedgerIssue, ledgerIssueKey } from '../ledger-issues'
import type { CommandOptions } from '../ports'
import {
  type AuditAction,
  type AuditChange,
  type AuditOperation,
  type DataTable,
  type JsonValue,
  type SettingRecord,
  type Stored,
  type TransactionRecord,
  USER_TABLES,
} from '../records'
import type { ContentCount } from '../storage/loss-marker'
import type { NexoDatabase } from './database'
import type { DexieReader } from './reader'
import { canonicalJson } from '../backup/canonical'
import { keyText, primaryKeyOf } from '../keys'
import {
  changedFields,
  toJsonObject,
  toTransactionRecord,
  toTransactionRow,
  withoutUndefined,
} from './rows'

export interface StoreContext {
  readonly db: NexoDatabase
  readonly env: Environment
  readonly reader: DexieReader
  /** Told, after every stored operation, how much the profile now holds. */
  readonly onCommitted?: (content: ContentCount) => void
}

export const LOCAL_LAST_CHANGE = 'lastChangeAt'

type Row = Readonly<Record<string, unknown>>

/**
 * Whether writing this row can pull a household pair apart. Accounts count too: the day the first
 * account opens is the day from which every household payment must show a cash movement.
 */
function touchesHousehold(table: DataTable, row: Row): boolean {
  if (table === 'sharedExpenses' || table === 'settlements' || table === 'accounts') {
    return true
  }
  return table === 'transactions' && (row.kind === 'shared_payment' || row.kind === 'settlement')
}

/** A plain copy that holds exactly what JSON can carry: no `undefined` at any depth. */
function plain<T extends object>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const MAX_KEY_LENGTH = 120

/**
 * A short mark of what a form sent. The same idempotency key must always come with the same
 * content: a key reused for something else is a mistake of the caller, never a silent success.
 */
function fingerprintOf(input: unknown): string {
  const text = canonicalJson(input ?? null)
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${(hash >>> 0).toString(16).padStart(8, '0')}-${String(text.length)}`
}

/**
 * Everything one operation writes. It lives inside a single IndexedDB transaction: either every
 * row and the audit entry are stored, or nothing is.
 */
export class UnitOfWork {
  readonly now: Instant
  readonly today: LocalDate
  private readonly changes: AuditChange[] = []
  /** The household contradictions that already existed before this operation touched anything. */
  private issuesBefore: Set<string> | null = null

  constructor(private readonly context: StoreContext) {
    this.now = context.env.now()
    this.today = context.env.today()
  }

  get db(): NexoDatabase {
    return this.context.db
  }

  get read(): DexieReader {
    return this.context.reader
  }

  newId(): string {
    return this.context.env.newId()
  }

  private async householdIssues(): Promise<LedgerIssue[]> {
    return this.read.ledgerIssues()
  }

  private async beforeWriting(table: DataTable, row: Row): Promise<void> {
    if (this.issuesBefore === null && touchesHousehold(table, row)) {
      this.issuesBefore = new Set((await this.householdIssues()).map(ledgerIssueKey))
    }
  }

  private stored(table: DataTable, row: object): object {
    return table === 'transactions' ? toTransactionRow(row as TransactionRecord) : row
  }

  private record(table: DataTable, action: AuditAction, before: object | null, after: object | null): void {
    const reference = (after ?? before ?? {}) as Row
    this.changes.push({
      table,
      key: keyText(table, reference),
      action,
      ...(before !== null ? { before: toJsonObject(before) } : {}),
      ...(after !== null ? { after: toJsonObject(after) } : {}),
      ...(before !== null && after !== null ? { changed: changedFields(before, after) } : {}),
    })
  }

  /** Stores a new row. Fails if one with the same key already exists. */
  async create<T extends object>(table: DataTable, value: T): Promise<Stored<T>> {
    const row: Stored<T> = plain({ ...withoutUndefined(value), createdAt: this.now, updatedAt: this.now })
    await this.beforeWriting(table, row as Row)
    await this.db.table<object>(table).add(this.stored(table, row))
    this.record(table, 'create', null, row)
    return row
  }

  /** Stores the next version of a row that exists. Nothing is written when nothing changed. */
  async replace<T extends object>(
    table: DataTable,
    before: Stored<T>,
    next: T,
    action: 'update' | 'void' = 'update',
  ): Promise<Stored<T>> {
    const previous = table === 'transactions' ? (toTransactionRecord(before as never) as never as Stored<T>) : before
    const row: Stored<T> = plain({ ...withoutUndefined(next), createdAt: previous.createdAt, updatedAt: this.now })
    if (changedFields(previous, row).length === 0) {
      return previous
    }
    await this.beforeWriting(table, row as Row)
    await this.db.table<object>(table).put(this.stored(table, row))
    this.record(table, action, previous, row)
    return row
  }

  /** Removes a row that is not a movement: a budget, a skipped occurrence, a coverage. */
  async remove(table: 'budgets' | 'cancelledOccurrences' | 'coverages', row: object): Promise<void> {
    await this.beforeWriting(table, row as Row)
    await this.db.table<object, string | [string, string]>(table).delete(primaryKeyOf(table, row as Row))
    this.record(table, 'remove', row, null)
  }

  async putSetting(before: SettingRecord | undefined, next: SettingRecord): Promise<void> {
    await this.db.settings.put(next)
    this.changes.push({
      table: 'settings',
      key: next.key,
      action: before === undefined ? 'create' : 'update',
      ...(before !== undefined ? { before: toJsonObject(before), changed: ['value'] } : {}),
      after: toJsonObject(next),
    })
  }

  /**
   * The operation may fix a household contradiction or leave the existing ones as they are, but
   * it must never create one: a shared expense without its cash movement, or the other way round,
   * makes money appear or disappear.
   */
  private async guardHousehold(): Promise<void> {
    if (this.issuesBefore === null) {
      return
    }
    const before = this.issuesBefore
    const created = (await this.householdIssues()).filter((issue) => !before.has(ledgerIssueKey(issue)))
    if (created.length > 0) {
      throw new DataError(
        'ledger_mismatch',
        'Este cambio dejaría un registro del hogar sin su contraparte. No se guardó nada.',
        created.map(describeLedgerIssue),
      )
    }
  }

  /** Checks the household, writes the audit entry and counts the change. */
  async finish(
    operation: AuditOperation,
    idempotencyKey: string | undefined,
    fingerprint: string,
    result: JsonValue,
  ): Promise<boolean> {
    await this.guardHousehold()
    if (this.changes.length === 0 && idempotencyKey === undefined) {
      return false
    }
    const last = await this.db.audit.orderBy('seq').last()
    await this.db.audit.add(
      plain({
        seq: (last?.seq ?? 0) + 1,
        at: this.now,
        operation,
        ...(idempotencyKey !== undefined ? { idempotencyKey, fingerprint } : {}),
        changes: this.changes,
        result,
      }),
    )
    await this.db.local.put({ key: LOCAL_LAST_CHANGE, value: this.now })
    return true
  }
}

async function contentCount(db: NexoDatabase): Promise<ContentCount> {
  let records = 0
  for (const table of USER_TABLES) {
    records += await db.table(table).count()
  }
  // The first entry of every trail is the one that prepared the profile.
  return { records, operations: Math.max(0, (await db.audit.count()) - 1) }
}

/**
 * Runs one operation: all its writes, the household check and the audit entry in one transaction.
 *
 * When the same idempotency key was already stored, nothing is written and the first answer comes
 * back: a double tap on «guardar» registers once.
 */
export async function commit<R extends JsonValue>(
  context: StoreContext,
  operation: AuditOperation,
  options: CommandOptions | undefined,
  /** What the form sent, exactly as it came. */
  input: unknown,
  work: (unit: UnitOfWork) => Promise<R>,
): Promise<R> {
  const { db } = context
  const idempotencyKey = options?.idempotencyKey
  // The key is stored in the audit trail, which can never be corrected: it is checked first.
  if (
    idempotencyKey !== undefined &&
    (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0 || idempotencyKey.length > MAX_KEY_LENGTH)
  ) {
    throw new DataError('invalid_input', 'La clave de la operación no es válida.')
  }
  const fingerprint = fingerprintOf(input)
  try {
    const outcome = await db.transaction('rw', db.tables, async () => {
      if ((await db.meta.get('profile')) === undefined) {
        throw new DataError('not_ready', 'Este perfil todavía no tiene datos: no se puede registrar nada.')
      }
      if (idempotencyKey !== undefined) {
        const earlier = await db.audit.where('idempotencyKey').equals(idempotencyKey).first()
        if (earlier !== undefined) {
          if (earlier.operation !== operation) {
            throw new DataError('conflict', 'Esa clave ya se usó para otra operación.')
          }
          if (earlier.fingerprint !== undefined && earlier.fingerprint !== fingerprint) {
            throw new DataError('conflict', 'Esa clave ya se usó para registrar otra cosa: no se guardó nada.')
          }
          return { result: earlier.result as R, content: null }
        }
      }
      const unit = new UnitOfWork(context)
      const result = await work(unit)
      const stored = await unit.finish(operation, idempotencyKey, fingerprint, result)
      return { result, content: stored ? await contentCount(db) : null }
    })
    if (outcome.content !== null) {
      context.onCommitted?.(outcome.content)
    }
    return outcome.result
  } catch (error) {
    const explained = toDataError(error)
    // Two confirmations that raced: the unique index of the table stopped the second one. Only a
    // refusal of the database itself means that; a conflict the operation explained stays as it is.
    const refusedByIndex = !isExplained(error) && explained instanceof DataError && explained.code === 'conflict'
    if (operation === 'occurrence.confirm' && refusedByIndex) {
      throw new DataError('duplicate_confirmation', 'Este movimiento programado ya fue confirmado.')
    }
    throw explained
  }
}
