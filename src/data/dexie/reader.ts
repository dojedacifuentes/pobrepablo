import { type LedgerIssue, type YearMonth, compareIds, householdLedgerIssues } from '@/domain'
import { DataError } from '../errors'
import { registeringSince } from '../ledger-issues'
import type { DateRange, LedgerData, ProfileReader } from '../ports'
import type {
  AccountRecord,
  AuditEntry,
  BudgetRecord,
  CategoryRecord,
  GoalRecord,
  JsonValue,
  MemberRecord,
  ProfileInfo,
  RuleRecord,
  SettlementRecord,
  SharedExpenseRecord,
  TransactionRecord,
} from '../records'
import type { NexoDatabase } from './database'
import { sortedByKey } from '../keys'
import { toTransactionRecord } from './rows'

const PROFILE_KEY = 'profile'

/** Oldest first; within a day, in the order they were registered; the id breaks any tie left. */
function byDateThenRegistration(a: TransactionRecord, b: TransactionRecord): number {
  return (
    (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
    (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) ||
    compareIds(a.id, b.id)
  )
}

function byDateThenId<T extends { readonly date: string; readonly id: string }>(a: T, b: T): number {
  return (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || compareIds(a.id, b.id)
}

/**
 * Every read of the store. All of them go through Dexie, so that a `liveQuery` wrapped around any
 * of them knows which tables it depends on, and they join the write transaction that calls them.
 */
export class DexieReader implements ProfileReader {
  constructor(protected readonly db: NexoDatabase) {}

  async profile(): Promise<ProfileInfo> {
    const profile = await this.db.meta.get(PROFILE_KEY)
    if (profile === undefined) {
      throw new DataError('not_ready', 'Este perfil todavía no tiene datos.')
    }
    return profile
  }

  ledger(): Promise<LedgerData> {
    const db = this.db
    return db.transaction('r', db.tables, async () => ({
      meta: await this.profile(),
      accounts: await this.accounts(),
      categories: await this.categories(),
      transactions: await this.transactions(),
      rules: await this.rules(),
      cancelledOccurrences: sortedByKey('cancelledOccurrences', await db.cancelledOccurrences.toArray()),
      coverages: sortedByKey('coverages', await db.coverages.toArray()),
      budgets: await this.budgets(),
      goals: await this.goals(),
      reservations: sortedByKey('reservations', await db.reservations.toArray()),
      members: await this.members(),
      sharedExpenses: await this.sharedExpenses(),
      settlements: await this.settlements(),
    }))
  }

  async accounts(): Promise<AccountRecord[]> {
    return sortedByKey('accounts', await this.db.accounts.toArray())
  }

  async categories(): Promise<CategoryRecord[]> {
    return sortedByKey('categories', await this.db.categories.toArray())
  }

  async transactions(range: DateRange = {}): Promise<TransactionRecord[]> {
    const { from, to } = range
    const rows =
      from === undefined && to === undefined
        ? await this.db.transactions.toArray()
        : await this.db.transactions
            .where('date')
            .between(from ?? '0000-00-00', to ?? '9999-99-99', true, true)
            .toArray()
    return rows.map(toTransactionRecord).sort(byDateThenRegistration)
  }

  async rules(): Promise<RuleRecord[]> {
    return sortedByKey('rules', await this.db.rules.toArray())
  }

  async budgets(month?: YearMonth): Promise<BudgetRecord[]> {
    const rows =
      month === undefined
        ? await this.db.budgets.toArray()
        : await this.db.budgets.where('month').equals(month).toArray()
    return sortedByKey('budgets', rows)
  }

  async goals(): Promise<GoalRecord[]> {
    return sortedByKey('goals', await this.db.goals.toArray())
  }

  async members(): Promise<MemberRecord[]> {
    return sortedByKey('members', await this.db.members.toArray())
  }

  async sharedExpenses(): Promise<SharedExpenseRecord[]> {
    return (await this.db.sharedExpenses.toArray()).sort(byDateThenId)
  }

  async settlements(): Promise<SettlementRecord[]> {
    return (await this.db.settlements.toArray()).sort(byDateThenId)
  }

  async settings(): Promise<Readonly<Record<string, JsonValue>>> {
    const rows = await this.db.settings.toArray()
    return Object.fromEntries(rows.map((row) => [row.key, row.value]))
  }

  async audit(options: { readonly last?: number } = {}): Promise<AuditEntry[]> {
    const newestFirst = this.db.audit.orderBy('seq').reverse()
    return options.last === undefined ? newestFirst.toArray() : newestFirst.limit(options.last).toArray()
  }

  ledgerIssues(): Promise<LedgerIssue[]> {
    const db = this.db
    return db.transaction('r', [db.meta, db.accounts, db.transactions, db.sharedExpenses, db.settlements], async () => {
      const profile = await this.profile()
      return householdLedgerIssues(
        profile.memberId,
        await this.transactions(),
        await this.sharedExpenses(),
        await this.settlements(),
        registeringSince(profile, await this.accounts()),
      )
    })
  }
}
