import type {
  Account,
  Budget,
  Category,
  Goal,
  GoalReservation,
  LocalDate,
  MemberId,
  OccurrenceRef,
  RecurringRule,
  RuleId,
  Settlement,
  SharedExpense,
  SharedExpenseId,
  Transaction,
  TransactionId,
} from '@/domain'
import type { Instant } from './environment'

/**
 * What is stored. Every row is a record of the domain plus two traces of when it was written.
 * Nothing derived is stored: no balance, no debt, no reserve. The domain recomputes them.
 */

/**
 * The version of the shape of the data. It grows together with the database schema: a backup
 * written with an older number is brought up to date before it is read.
 */
export const DATA_MODEL_VERSION = 1

export interface StoredMeta {
  readonly createdAt: Instant
  readonly updatedAt: Instant
}

export type Stored<T> = T & StoredMeta

export type ProfileId = 'pablo' | 'diego' | 'demo'

/** A `demo` profile holds only invented figures and can never exchange data with a personal one. */
export type ProfileKind = 'personal' | 'demo'

/** Who this database belongs to. A single row of the `meta` table, under the key `profile`. */
export interface ProfileInfo {
  readonly key: 'profile'
  readonly id: ProfileId
  readonly kind: ProfileKind
  readonly name: string
  /** Who this person is inside the household. */
  readonly memberId: MemberId
  /**
   * The day the profile was created. Until the first account exists, household events older than
   * this need no cash movement on this phone (see `registeringSince`).
   */
  readonly startedOn: LocalDate
  readonly createdAt: Instant
}

export interface Member {
  readonly id: MemberId
  readonly name: string
}

export type AccountRecord = Stored<Account>
export type CategoryRecord = Stored<Category>
export type TransactionRecord = Stored<Transaction>
export type RuleRecord = Stored<RecurringRule>
export type BudgetRecord = Stored<Budget>
export type GoalRecord = Stored<Goal>
/**
 * A reservation as stored. When it is the release that «turn the reserve into a transfer» wrote,
 * it remembers that transfer: the two are undone together or not at all.
 */
export type ReservationRecord = Stored<GoalReservation> & { readonly transferId?: TransactionId }
export type MemberRecord = Stored<Member>
export type SharedExpenseRecord = Stored<SharedExpense>
export type SettlementRecord = Stored<Settlement>

/** A programmed occurrence that the person decided to skip. */
export type CancelledOccurrenceRecord = Stored<OccurrenceRef>

/** «This shared expense is that programmed expense»: see `coverage.ts` in the domain. */
export interface Coverage {
  readonly ruleId: RuleId
  readonly dueDate: LocalDate
  readonly sharedExpenseId: SharedExpenseId
}
export type CoverageRecord = Stored<Coverage>

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

/** A preference that must survive a restart and travel inside the backups. */
export interface SettingRecord {
  readonly key: string
  readonly value: JsonValue
  readonly updatedAt: Instant
}

/** The tables that make up a person's data. All of them, and nothing else, travel in a backup. */
export const DATA_TABLES = [
  'accounts',
  'categories',
  'transactions',
  'rules',
  'cancelledOccurrences',
  'coverages',
  'budgets',
  'goals',
  'reservations',
  'members',
  'sharedExpenses',
  'settlements',
  'settings',
] as const

export type DataTable = (typeof DATA_TABLES)[number]

/** The tables whose rows are what the person registered. Counted for the data-loss marker. */
export const USER_TABLES = [
  'accounts',
  'transactions',
  'rules',
  'budgets',
  'goals',
  'reservations',
  'sharedExpenses',
  'settlements',
] as const satisfies readonly DataTable[]

export const AUDIT_OPERATIONS = [
  'profile.seed',
  'profile.restore',
  'account.create',
  'account.update',
  'category.create',
  'category.update',
  'transaction.create',
  'transaction.edit',
  'transaction.void',
  'rule.create',
  'rule.update',
  'rule.close',
  'rule.reschedule',
  'occurrence.confirm',
  'occurrence.skip',
  'occurrence.unskip',
  'occurrence.cover',
  'occurrence.uncover',
  'budget.set',
  'budget.remove',
  'goal.create',
  'goal.update',
  'goal.reserve',
  'goal.release',
  'goal.fulfil',
  'reservation.void',
  'shared_expense.create',
  'shared_expense.void',
  'settlement.create',
  'settlement.void',
  'setting.set',
] as const

export type AuditOperation = (typeof AUDIT_OPERATIONS)[number]

export type AuditAction = 'create' | 'update' | 'void' | 'remove'

/** One row touched by an operation, with how it was and how it ended up. */
export interface AuditChange {
  readonly table: DataTable | 'meta'
  readonly key: string
  readonly action: AuditAction
  readonly before?: JsonObject
  readonly after?: JsonObject
  /** On an update: the fields whose value changed (amount, categoryId, shares…). */
  readonly changed?: readonly string[]
}

/**
 * One operation, as it happened. The audit trail only grows: an entry is never edited nor removed.
 * It also carries the idempotency key of the form that caused it, which is what stops a double
 * tap from registering twice.
 */
export interface AuditEntry {
  /** 1, 2, 3… in the order the operations were stored. */
  readonly seq: number
  readonly at: Instant
  readonly operation: AuditOperation
  readonly idempotencyKey?: string
  /** A mark of what the form sent with that key, to refuse the key if it comes with something else. */
  readonly fingerprint?: string
  readonly changes: readonly AuditChange[]
  /** What the operation answered, so that a repeated request gets the very same answer. */
  readonly result?: JsonValue
}

/** Everything that belongs to one profile: exactly what a backup contains. */
export interface ProfileSnapshot {
  readonly meta: ProfileInfo
  readonly accounts: readonly AccountRecord[]
  readonly categories: readonly CategoryRecord[]
  readonly transactions: readonly TransactionRecord[]
  readonly rules: readonly RuleRecord[]
  readonly cancelledOccurrences: readonly CancelledOccurrenceRecord[]
  readonly coverages: readonly CoverageRecord[]
  readonly budgets: readonly BudgetRecord[]
  readonly goals: readonly GoalRecord[]
  readonly reservations: readonly ReservationRecord[]
  readonly members: readonly MemberRecord[]
  readonly sharedExpenses: readonly SharedExpenseRecord[]
  readonly settlements: readonly SettlementRecord[]
  readonly settings: readonly SettingRecord[]
  readonly audit: readonly AuditEntry[]
}

/** How many rows the person has registered. */
export function countUserRecords(snapshot: ProfileSnapshot): number {
  return USER_TABLES.reduce((total, table) => total + snapshot[table].length, 0)
}
