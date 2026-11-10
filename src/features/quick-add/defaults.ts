import type { AccountRecord, CategoryRecord, TransactionRecord } from '@/data'
import { type AccountId, type Category, DEFAULT_CATEGORIES, accountClass } from '@/domain'

/**
 * The sensible defaults of the quick-add sheet: the categories the person uses most come first,
 * and the account is the one they used last. Counting uses is not accounting: no amount is read.
 */

const SEED_ORDER = new Map(DEFAULT_CATEGORIES.map((category, index) => [category.id as string, index]))

/** Categories of one kind that are not archived: most used first, then in the order of the starting set. */
export function categoriesByUse(
  categories: readonly CategoryRecord[],
  transactions: readonly TransactionRecord[],
  kind: Category['kind'],
): CategoryRecord[] {
  const uses = new Map<string, number>()
  for (const transaction of transactions) {
    if (!transaction.voided && transaction.kind === kind) {
      uses.set(transaction.categoryId, (uses.get(transaction.categoryId) ?? 0) + 1)
    }
  }
  const position = (category: CategoryRecord): number => SEED_ORDER.get(category.id) ?? SEED_ORDER.size
  return categories
    .filter((category) => category.kind === kind && !category.archived)
    .toSorted(
      (a, b) =>
        (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0) || position(a) - position(b) || a.name.localeCompare(b.name, 'es'),
    )
}

/** Accounts that can be chosen: the ones that are not archived. */
export function usableAccounts(accounts: readonly AccountRecord[]): AccountRecord[] {
  return accounts.filter((account) => !account.archived)
}

/**
 * The account to offer first: the one of the most recent movement of that kind; with no history,
 * the first account money can be spent from.
 */
export function defaultAccount(
  accounts: readonly AccountRecord[],
  transactions: readonly TransactionRecord[],
  kind: 'expense' | 'income' | 'transfer',
): AccountId | undefined {
  const usable = usableAccounts(accounts)
  const known = new Set<string>(usable.map((account) => account.id))
  // `transactions` come oldest first: the last one that matches is the most recent.
  for (const transaction of transactions.toReversed()) {
    if (transaction.voided || transaction.kind !== kind) {
      continue
    }
    const accountId = transaction.kind === 'transfer' ? transaction.fromAccountId : transaction.accountId
    if (known.has(accountId)) {
      return accountId
    }
  }
  return (usable.find((account) => accountClass(account.kind) === 'liquid') ?? usable[0])?.id
}

/** The other account of a transfer: the last destination used from `from`, or any other account. */
export function defaultDestination(
  accounts: readonly AccountRecord[],
  transactions: readonly TransactionRecord[],
  from: AccountId | undefined,
): AccountId | undefined {
  const usable = usableAccounts(accounts).filter((account) => account.id !== from)
  const known = new Set<string>(usable.map((account) => account.id))
  for (const transaction of transactions.toReversed()) {
    if (!transaction.voided && transaction.kind === 'transfer' && transaction.fromAccountId === from) {
      if (known.has(transaction.toAccountId)) {
        return transaction.toAccountId
      }
    }
  }
  return usable[0]?.id
}
