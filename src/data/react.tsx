import { useObservable } from 'dexie-react-hooks'
import { type ReactNode, createContext, useContext } from 'react'
import {
  type FinancialSnapshot,
  type LedgerIssue,
  type LocalDate,
  type YearMonth,
  financialSnapshot,
  firstDayOf,
  lastDayOf,
} from '@/domain'
import { type DeviceState, type LedgerData, type ProfileReader, type ProfileStore, toSnapshotInput } from './ports'
import type {
  AccountRecord,
  AuditEntry,
  BudgetRecord,
  CategoryRecord,
  GoalRecord,
  JsonValue,
  RuleRecord,
  TransactionRecord,
} from './records'
import type { ProfileSession } from './session'

/**
 * The database is the state (ADR 0003). These hooks are the only way the screens read it: each
 * one re-renders its component whenever the stored data it read changes, and only then.
 *
 * Every hook answers `undefined` while the first read is on its way. A failed read is thrown to
 * the nearest error boundary. The screens never import Dexie: a lint rule forbids it.
 */

const SessionContext = createContext<ProfileSession | null>(null)

export function ProfileProvider({ session, children }: { session: ProfileSession; children: ReactNode }) {
  return <SessionContext value={session}>{children}</SessionContext>
}

export function useProfileSession(): ProfileSession {
  const session = useContext(SessionContext)
  if (session === null) {
    throw new Error('Falta <ProfileProvider>: no hay ningún perfil abierto')
  }
  return session
}

/** The store of the open profile: its operations, to be called from event handlers. */
export function useProfileStore(): ProfileStore {
  return useProfileSession().store
}

/**
 * Reads from the store and keeps the answer up to date. `query` must only read; `deps` lists what
 * it uses from the component, like the dependencies of an effect.
 */
export function useStoreQuery<T>(
  query: (reader: ProfileReader) => Promise<T>,
  deps: readonly unknown[] = [],
): T | undefined {
  const store = useProfileStore()
  return useObservable(() => store.watch(query), [store, ...deps])
}

/** Everything stored about the person's finances. The domain computes every figure from this. */
export function useLedger(): LedgerData | undefined {
  return useStoreQuery((reader) => reader.ledger())
}

/** Every magnitude of the dashboard as of `today`, recomputed whenever anything stored changes. */
export function useFinancialSnapshot(today: LocalDate): FinancialSnapshot | undefined {
  return useStoreQuery(
    async (reader) => financialSnapshot(toSnapshotInput(await reader.ledger(), today)),
    [today],
  )
}

export function useAccounts(): AccountRecord[] | undefined {
  return useStoreQuery((reader) => reader.accounts())
}

export function useCategories(): CategoryRecord[] | undefined {
  return useStoreQuery((reader) => reader.categories())
}

/** The movements of one month, newest first, voided ones included. */
export function useMonthActivity(month: YearMonth): TransactionRecord[] | undefined {
  return useStoreQuery(
    async (reader) => (await reader.transactions({ from: firstDayOf(month), to: lastDayOf(month) })).reverse(),
    [month],
  )
}

/** The last movements registered, newest first, voided ones included. */
export function useRecentActivity(limit: number): TransactionRecord[] | undefined {
  return useStoreQuery(async (reader) => (await reader.transactions()).reverse().slice(0, limit), [limit])
}

export function useRules(): RuleRecord[] | undefined {
  return useStoreQuery((reader) => reader.rules())
}

export function useBudgets(month: YearMonth): BudgetRecord[] | undefined {
  return useStoreQuery((reader) => reader.budgets(month), [month])
}

export function useGoals(): GoalRecord[] | undefined {
  return useStoreQuery((reader) => reader.goals())
}

export function useSettings(): Readonly<Record<string, JsonValue>> | undefined {
  return useStoreQuery((reader) => reader.settings())
}

export function useAuditTrail(last: number): AuditEntry[] | undefined {
  return useStoreQuery((reader) => reader.audit({ last }), [last])
}

/** Household records whose counterpart is missing on this phone. Empty when all is coherent. */
export function useLedgerIssues(): LedgerIssue[] | undefined {
  return useStoreQuery((reader) => reader.ledgerIssues())
}

/** What this device knows about itself: pending changes since the last backup, restores, persistence. */
export function useDeviceState(): DeviceState | undefined {
  const store = useProfileStore()
  return useObservable(() => store.watch(() => store.deviceState()), [store])
}
