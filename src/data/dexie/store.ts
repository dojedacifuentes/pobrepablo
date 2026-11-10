import { liveQuery } from 'dexie'
import type {
  AccountId,
  Budget,
  CategoryId,
  GoalId,
  LocalDate,
  OccurrenceRef,
  ReservationId,
  RuleId,
  SettlementId,
  SharedExpenseId,
  TransactionId,
  YearMonth,
} from '@/domain'
import type { Environment, Instant } from '../environment'
import { DataError, toDataError } from '../errors'
import type {
  AccountEdit,
  CategoryEdit,
  CommandOptions,
  ConfirmOccurrenceInput,
  DeviceState,
  FulfilInput,
  GoalEdit,
  NewAccount,
  NewCategory,
  NewGoal,
  NewRule,
  NewSettlement,
  NewSharedExpense,
  NewTransaction,
  PersistenceState,
  ProfileReader,
  ProfileStore,
  RescheduleInput,
  ReservationInput,
  RestoreNote,
  RuleEdit,
  TransactionEdit,
  Watchable,
} from '../ports'
import type { ProfileDescriptor } from '../profiles'
import type { JsonValue, ProfileSnapshot } from '../records'
import type { ContentCount } from '../storage/loss-marker'
import * as accounts from './commands/accounts'
import * as household from './commands/household'
import * as occurrences from './commands/occurrences'
import * as planning from './commands/planning'
import * as rules from './commands/rules'
import * as transactions from './commands/transactions'
import type { NexoDatabase } from './database'
import { DexieReader } from './reader'
import { eraseAll, noteBackupSaved, notePersistence, readDeviceState, readSnapshot, writeSnapshot } from './snapshot'
import type { StoreContext } from './unit-of-work'

export interface StoreHooks {
  /** Told how much the profile holds after every change; `null` when it was erased on purpose. */
  readonly onContentChanged?: (content: ContentCount | null) => void
}

/** The store of one profile, on IndexedDB through Dexie. The only implementation for now. */
export class DexieProfileStore extends DexieReader implements ProfileStore {
  private readonly context: StoreContext

  constructor(
    db: NexoDatabase,
    private readonly env: Environment,
    /** Whose data this store keeps. Nothing of anybody else is ever written to it. */
    private readonly owner: ProfileDescriptor,
    private readonly hooks: StoreHooks = {},
  ) {
    super(db)
    this.context = {
      db,
      env,
      reader: this,
      ...(hooks.onContentChanged !== undefined ? { onCommitted: hooks.onContentChanged } : {}),
    }
  }

  // ── Watching ───────────────────────────────────────────────────────────────────────────────

  watch<T>(query: (reader: ProfileReader) => Promise<T>): Watchable<T> {
    const observable = liveQuery(() => query(this))
    return {
      subscribe: (onNext, onError) =>
        observable.subscribe({
          next: onNext,
          error: (error: unknown) => onError?.(toDataError(error)),
        }),
    }
  }

  // ── Writing ────────────────────────────────────────────────────────────────────────────────

  createAccount(input: NewAccount, options?: CommandOptions) {
    return accounts.createAccount(this.context, input, options)
  }
  updateAccount(id: AccountId, edit: AccountEdit, options?: CommandOptions) {
    return accounts.updateAccount(this.context, id, edit, options)
  }
  createCategory(input: NewCategory, options?: CommandOptions) {
    return accounts.createCategory(this.context, input, options)
  }
  updateCategory(id: CategoryId, edit: CategoryEdit, options?: CommandOptions) {
    return accounts.updateCategory(this.context, id, edit, options)
  }

  recordTransaction(input: NewTransaction, options?: CommandOptions) {
    return transactions.recordTransaction(this.context, input, options)
  }
  editTransaction(id: TransactionId, next: TransactionEdit, options?: CommandOptions) {
    return transactions.editTransaction(this.context, id, next, options)
  }
  voidTransaction(id: TransactionId, options?: CommandOptions) {
    return transactions.voidTransactionCommand(this.context, id, options)
  }

  createRule(input: NewRule, options?: CommandOptions) {
    return rules.createRule(this.context, input, options)
  }
  updateRule(id: RuleId, edit: RuleEdit, options?: CommandOptions) {
    return rules.updateRule(this.context, id, edit, options)
  }
  closeRule(id: RuleId, endDate: LocalDate, options?: CommandOptions) {
    return rules.closeRule(this.context, id, endDate, options)
  }
  rescheduleRule(id: RuleId, input: RescheduleInput, options?: CommandOptions) {
    return rules.rescheduleRuleCommand(this.context, id, input, options)
  }

  confirmOccurrence(input: ConfirmOccurrenceInput, options?: CommandOptions) {
    return occurrences.confirmOccurrenceCommand(this.context, input, options)
  }
  skipOccurrence(ref: OccurrenceRef, options?: CommandOptions) {
    return occurrences.skipOccurrence(this.context, ref, options)
  }
  unskipOccurrence(ref: OccurrenceRef, options?: CommandOptions) {
    return occurrences.unskipOccurrence(this.context, ref, options)
  }
  coverOccurrence(ref: OccurrenceRef, sharedExpenseId: SharedExpenseId, options?: CommandOptions) {
    return occurrences.coverOccurrence(this.context, ref, sharedExpenseId, options)
  }
  uncoverOccurrence(ref: OccurrenceRef, options?: CommandOptions) {
    return occurrences.uncoverOccurrence(this.context, ref, options)
  }

  setBudget(budget: Budget, options?: CommandOptions) {
    return planning.setBudget(this.context, budget, options)
  }
  removeBudget(categoryId: CategoryId, month: YearMonth, options?: CommandOptions) {
    return planning.removeBudget(this.context, categoryId, month, options)
  }
  createGoal(input: NewGoal, options?: CommandOptions) {
    return planning.createGoal(this.context, input, options)
  }
  updateGoal(id: GoalId, edit: GoalEdit, options?: CommandOptions) {
    return planning.updateGoal(this.context, id, edit, options)
  }
  reserveForGoal(input: ReservationInput, options?: CommandOptions) {
    return planning.reserveForGoal(this.context, input, options)
  }
  releaseFromGoal(input: ReservationInput, options?: CommandOptions) {
    return planning.releaseFromGoal(this.context, input, options)
  }
  voidReservation(id: ReservationId, options?: CommandOptions) {
    return planning.voidReservation(this.context, id, options)
  }
  fulfilReservation(input: FulfilInput, options?: CommandOptions) {
    return planning.fulfilReservationCommand(this.context, input, options)
  }

  recordSharedExpense(input: NewSharedExpense, options?: CommandOptions) {
    return household.recordSharedExpenseCommand(this.context, input, options)
  }
  voidSharedExpense(id: SharedExpenseId, options?: CommandOptions) {
    return household.voidSharedExpenseCommand(this.context, id, options)
  }
  recordSettlement(input: NewSettlement, options?: CommandOptions) {
    return household.recordSettlementCommand(this.context, input, options)
  }
  voidSettlement(id: SettlementId, options?: CommandOptions) {
    return household.voidSettlementCommand(this.context, id, options)
  }

  setSetting(key: string, value: JsonValue, options?: CommandOptions) {
    return household.setSetting(this.context, key, value, options)
  }

  // ── The whole profile ──────────────────────────────────────────────────────────────────────

  async exportSnapshot(): Promise<ProfileSnapshot> {
    try {
      return await readSnapshot(this.db)
    } catch (error) {
      throw toDataError(error)
    }
  }

  async replaceWith(snapshot: ProfileSnapshot, restore?: RestoreNote): Promise<void> {
    const { id, kind, memberId } = snapshot.meta
    if (id !== this.owner.id || kind !== this.owner.kind || memberId !== this.owner.memberId) {
      throw new DataError(
        'conflict',
        kind !== this.owner.kind
          ? 'Las cifras inventadas de la Demo y los datos reales nunca se mezclan: no se guardó nada.'
          : `Estos datos son del perfil de ${snapshot.meta.name}, no de ${this.owner.name}: no se guardó nada.`,
      )
    }
    let content: ContentCount
    try {
      content = await writeSnapshot(this.db, snapshot, restore)
    } catch (error) {
      throw toDataError(error)
    }
    this.hooks.onContentChanged?.(content)
  }

  async erase(): Promise<void> {
    try {
      await eraseAll(this.db)
    } catch (error) {
      throw toDataError(error)
    }
    this.hooks.onContentChanged?.(null)
  }

  // ── This device ────────────────────────────────────────────────────────────────────────────

  deviceState(): Promise<DeviceState> {
    return readDeviceState(this.db)
  }
  noteBackupSaved(at: Instant, throughSeq: number): Promise<void> {
    return noteBackupSaved(this.db, at, throughSeq)
  }
  notePersistence(state: PersistenceState): Promise<void> {
    return notePersistence(this.db, state, this.env.now())
  }

  close(): void {
    this.db.close()
  }
}
