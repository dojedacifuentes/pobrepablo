import type {
  Account,
  AccountId,
  Adjustment,
  Budget,
  Category,
  CategoryId,
  Expense,
  Goal,
  GoalId,
  Income,
  LedgerIssue,
  LocalDate,
  MemberId,
  Money,
  OccurrenceRef,
  RecurringRule,
  ReservationId,
  RuleId,
  ScheduleChange,
  SettlementId,
  Share,
  SharedExpenseId,
  SnapshotInput,
  TransactionId,
  Transfer,
  YearMonth,
} from '@/domain'
import type { Instant } from './environment'
import type {
  AccountRecord,
  AuditEntry,
  BudgetRecord,
  CategoryRecord,
  GoalRecord,
  JsonValue,
  MemberRecord,
  ProfileInfo,
  ProfileSnapshot,
  RuleRecord,
  SettlementRecord,
  SharedExpenseRecord,
  TransactionRecord,
} from './records'

/**
 * The contract between the screens and whatever keeps the data. `features/` only knows these
 * interfaces. Today they are implemented with Dexie on IndexedDB; a future synchronisation layer
 * can implement them again without touching the domain or the screens.
 */

/** A person's whole financial record, as stored. Everything the domain needs to compute. */
export type LedgerData = Omit<ProfileSnapshot, 'audit' | 'settings'>

/** The stored facts in the shape the domain computes from. */
export function toSnapshotInput(ledger: LedgerData, today: LocalDate): SnapshotInput {
  return {
    accounts: ledger.accounts,
    transactions: ledger.transactions,
    rules: ledger.rules,
    cancelledOccurrences: ledger.cancelledOccurrences,
    sharedCoverage: ledger.coverages.map((coverage) => ({
      ref: { ruleId: coverage.ruleId, dueDate: coverage.dueDate },
      sharedExpenseId: coverage.sharedExpenseId,
    })),
    budgets: ledger.budgets,
    goals: ledger.goals,
    reservations: ledger.reservations,
    household: {
      memberId: ledger.meta.memberId,
      members: ledger.members.map((member) => member.id),
      expenses: ledger.sharedExpenses,
      settlements: ledger.settlements,
    },
    today,
  }
}

// ── Reading ──────────────────────────────────────────────────────────────────────────────────

export interface DateRange {
  readonly from?: LocalDate
  readonly to?: LocalDate
}

export interface ProfileReader {
  profile(): Promise<ProfileInfo>
  /** Everything at once, read at a single moment: what the dashboard computes from. */
  ledger(): Promise<LedgerData>
  accounts(): Promise<AccountRecord[]>
  categories(): Promise<CategoryRecord[]>
  /** Oldest first; within a day, in the order they were registered. Voided ones are included. */
  transactions(range?: DateRange): Promise<TransactionRecord[]>
  rules(): Promise<RuleRecord[]>
  budgets(month?: YearMonth): Promise<BudgetRecord[]>
  goals(): Promise<GoalRecord[]>
  members(): Promise<MemberRecord[]>
  sharedExpenses(): Promise<SharedExpenseRecord[]>
  settlements(): Promise<SettlementRecord[]>
  settings(): Promise<Readonly<Record<string, JsonValue>>>
  /** Newest first. */
  audit(options?: { readonly last?: number }): Promise<AuditEntry[]>
  /** Household records whose counterpart is missing on this phone. Empty when all is coherent. */
  ledgerIssues(): Promise<LedgerIssue[]>
}

// ── Writing ──────────────────────────────────────────────────────────────────────────────────

/**
 * Every operation that comes from a form carries the key of that form. Sending the same key again
 * (a double tap, a retry) changes nothing and answers exactly what the first time answered.
 */
export interface CommandOptions {
  readonly idempotencyKey?: string
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** A movement the person registers by hand. Household movements have their own operations. */
export type NewTransaction = DistributiveOmit<
  Expense | Income | Transfer | Adjustment,
  'id' | 'voided' | 'occurrence'
> & { readonly id?: TransactionId }

/** The corrected movement, whole. Its kind and the occurrence it confirms cannot change. */
export type TransactionEdit = DistributiveOmit<
  Expense | Income | Transfer | Adjustment,
  'id' | 'voided' | 'occurrence'
>

export type NewAccount = Omit<Account, 'id' | 'archived'> & { readonly id?: AccountId }
/** A field given as `undefined` is removed (a card that no longer has a statement day). */
export type AccountEdit = Partial<Omit<Account, 'id' | 'kind'>>

export type NewCategory = Omit<Category, 'id' | 'archived'> & { readonly id?: CategoryId }
export type CategoryEdit = Partial<Pick<Category, 'name' | 'sensitive' | 'archived'>>

export type NewRule = Omit<RecurringRule, 'id' | 'paused'> & { readonly id?: RuleId }

/**
 * What can be changed on a rule in place. Its calendar (start, frequency, interval, accounts) is
 * deliberately absent: the occurrences of a rule are identified by their dates, so moving them
 * would orphan every payment already confirmed. The calendar changes only with `rescheduleRule`.
 */
export type RuleEdit = Partial<Pick<RecurringRule, 'label' | 'amount' | 'amountIsEstimate' | 'categoryId' | 'paused'>>

export interface RescheduleInput extends ScheduleChange {
  /** The last day on which the current calendar still applies. */
  readonly lastDayOfOld: LocalDate
  /** The first day of the new calendar. */
  readonly startDate: LocalDate
  readonly id?: RuleId
}

export interface ConfirmOccurrenceInput {
  readonly ref: OccurrenceRef
  /** The day the money really moved. Never in the future. */
  readonly date: LocalDate
  /** The real amount, when it differs from the programmed one. */
  readonly amount?: Money
  /** Credit-card expenses only. */
  readonly installments?: number
  readonly note?: string
  readonly transactionId?: TransactionId
  /**
   * Expenses only: this payment is also a shared household expense. The shared expense and the
   * cash movement are stored together, in the same operation.
   */
  readonly shared?: {
    readonly id?: SharedExpenseId
    readonly description: string
    readonly shares: readonly Share<MemberId>[]
  }
}

export type NewGoal = Omit<Goal, 'id' | 'archived'> & { readonly id?: GoalId }
export type GoalEdit = Partial<Omit<Goal, 'id'>>

export interface ReservationInput {
  readonly goalId: GoalId
  /** Always positive: the operation says whether it reserves or releases. */
  readonly amount: Money
  readonly date: LocalDate
  readonly id?: ReservationId
}

export interface FulfilInput {
  readonly goalId: GoalId
  readonly amount: Money
  readonly date: LocalDate
  readonly fromAccountId: AccountId
  /** A savings account. */
  readonly toAccountId: AccountId
  readonly reservationId?: ReservationId
  readonly transactionId?: TransactionId
}

export interface NewSharedExpense {
  readonly id?: SharedExpenseId
  readonly date: LocalDate
  readonly description: string
  readonly categoryId: CategoryId
  readonly total: Money
  readonly payerId: MemberId
  readonly shares: readonly Share<MemberId>[]
  /**
   * The account the money left. Required when the person of this profile is who paid, unless the
   * expense is older than the day they started registering.
   */
  readonly payment?: {
    readonly accountId: AccountId
    readonly transactionId?: TransactionId
    /** Credit cards only. */
    readonly installments?: number
  }
}

export interface NewSettlement {
  readonly id?: SettlementId
  readonly date: LocalDate
  readonly fromMemberId: MemberId
  readonly toMemberId: MemberId
  readonly amount: Money
  /** The account the money went through. Required when this profile's person gave or received it. */
  readonly movement?: { readonly accountId: AccountId; readonly transactionId?: TransactionId }
}

export interface ProfileWriter {
  createAccount(input: NewAccount, options?: CommandOptions): Promise<{ accountId: AccountId }>
  updateAccount(id: AccountId, edit: AccountEdit, options?: CommandOptions): Promise<{ accountId: AccountId }>

  createCategory(input: NewCategory, options?: CommandOptions): Promise<{ categoryId: CategoryId }>
  updateCategory(id: CategoryId, edit: CategoryEdit, options?: CommandOptions): Promise<{ categoryId: CategoryId }>

  recordTransaction(input: NewTransaction, options?: CommandOptions): Promise<{ transactionId: TransactionId }>
  editTransaction(
    id: TransactionId,
    next: TransactionEdit,
    options?: CommandOptions,
  ): Promise<{ transactionId: TransactionId }>
  /** The movement stays in the history, marked as voided, and stops counting everywhere. */
  voidTransaction(id: TransactionId, options?: CommandOptions): Promise<{ transactionId: TransactionId }>

  createRule(input: NewRule, options?: CommandOptions): Promise<{ ruleId: RuleId }>
  updateRule(id: RuleId, edit: RuleEdit, options?: CommandOptions): Promise<{ ruleId: RuleId }>
  /** Ends a rule on a day. What was programmed up to that day stays as it is. */
  closeRule(id: RuleId, endDate: LocalDate, options?: CommandOptions): Promise<{ ruleId: RuleId }>
  /** The only way to change the calendar of a rule: closes it and starts a new one. */
  rescheduleRule(
    id: RuleId,
    input: RescheduleInput,
    options?: CommandOptions,
  ): Promise<{ closedRuleId: RuleId; ruleId: RuleId }>

  confirmOccurrence(
    input: ConfirmOccurrenceInput,
    options?: CommandOptions,
  ): Promise<{ transactionId: TransactionId; sharedExpenseId: SharedExpenseId | null }>
  skipOccurrence(ref: OccurrenceRef, options?: CommandOptions): Promise<{ skipped: boolean }>
  unskipOccurrence(ref: OccurrenceRef, options?: CommandOptions): Promise<{ skipped: boolean }>
  /** «This shared expense, paid by somebody else, is that programmed expense.» */
  coverOccurrence(
    ref: OccurrenceRef,
    sharedExpenseId: SharedExpenseId,
    options?: CommandOptions,
  ): Promise<{ covered: boolean }>
  uncoverOccurrence(ref: OccurrenceRef, options?: CommandOptions): Promise<{ covered: boolean }>

  setBudget(budget: Budget, options?: CommandOptions): Promise<{ categoryId: CategoryId; month: YearMonth }>
  removeBudget(categoryId: CategoryId, month: YearMonth, options?: CommandOptions): Promise<{ removed: boolean }>

  createGoal(input: NewGoal, options?: CommandOptions): Promise<{ goalId: GoalId }>
  updateGoal(id: GoalId, edit: GoalEdit, options?: CommandOptions): Promise<{ goalId: GoalId }>
  reserveForGoal(input: ReservationInput, options?: CommandOptions): Promise<{ reservationId: ReservationId }>
  releaseFromGoal(input: ReservationInput, options?: CommandOptions): Promise<{ reservationId: ReservationId }>
  voidReservation(id: ReservationId, options?: CommandOptions): Promise<{ reservationId: ReservationId }>
  /** Turns reserved money into a real transfer to savings: the release and the transfer together. */
  fulfilReservation(
    input: FulfilInput,
    options?: CommandOptions,
  ): Promise<{ reservationId: ReservationId; transactionId: TransactionId }>

  /** The shared expense and, when this person paid, the cash movement: both or neither. */
  recordSharedExpense(
    input: NewSharedExpense,
    options?: CommandOptions,
  ): Promise<{ sharedExpenseId: SharedExpenseId; transactionId: TransactionId | null }>
  voidSharedExpense(id: SharedExpenseId, options?: CommandOptions): Promise<{ sharedExpenseId: SharedExpenseId }>
  recordSettlement(
    input: NewSettlement,
    options?: CommandOptions,
  ): Promise<{ settlementId: SettlementId; transactionId: TransactionId | null }>
  voidSettlement(id: SettlementId, options?: CommandOptions): Promise<{ settlementId: SettlementId }>

  setSetting(key: string, value: JsonValue, options?: CommandOptions): Promise<{ key: string }>
}

// ── Watching ─────────────────────────────────────────────────────────────────────────────────

export interface Unsubscribable {
  unsubscribe(): void
}

/** A value that is delivered again every time the stored data it was read from changes. */
export interface Watchable<T> {
  subscribe(onNext: (value: T) => void, onError?: (error: unknown) => void): Unsubscribable
}

// ── This device ──────────────────────────────────────────────────────────────────────────────

/** A backup that was restored on this device. Kept here, not inside the person's data. */
export interface RestoreNote {
  readonly at: Instant
  readonly exportId: string
  readonly exportedAt: Instant
  readonly records: number
}

export type PersistenceState = 'persisted' | 'best_effort' | 'unsupported' | 'failed'

/** Facts about this phone. They do not travel in a backup. */
export interface DeviceState {
  /** Operations stored after the last one that the latest backup of this device holds. */
  readonly changesSinceBackup: number
  readonly lastChangeAt: Instant | null
  readonly lastBackupAt: Instant | null
  /** Newest last. */
  readonly restores: readonly RestoreNote[]
  readonly persistence: { readonly state: PersistenceState; readonly at: Instant } | null
}

// ── The whole store ──────────────────────────────────────────────────────────────────────────

export interface ProfileStore extends ProfileReader, ProfileWriter {
  /** Re-runs `query` whenever the data it read changes. This is what the hooks are built on. */
  watch<T>(query: (reader: ProfileReader) => Promise<T>): Watchable<T>

  /** Everything, exactly as stored: the content of a backup. */
  exportSnapshot(): Promise<ProfileSnapshot>
  /**
   * Replaces everything with the given snapshot, all or nothing. The snapshot must already have
   * been validated (`backup/integrity.ts`), and it must belong to this very profile: the data of
   * another person, or the invented data of the Demo, is refused here too.
   */
  replaceWith(snapshot: ProfileSnapshot, restore?: RestoreNote): Promise<void>
  /** Deletes every record of this profile. Explicit and destructive: the interface must warn. */
  erase(): Promise<void>

  deviceState(): Promise<DeviceState>
  /** A backup holding the audit trail up to `throughSeq` was saved outside this phone. */
  noteBackupSaved(at: Instant, throughSeq: number): Promise<void>
  notePersistence(state: PersistenceState): Promise<void>

  close(): void
}
