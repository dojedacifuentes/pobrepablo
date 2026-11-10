import { type Account, type AccountClass, accountClass } from './accounts'
import type { LocalDate } from './dates'
import { invariant } from './errors'
import type { AccountId } from './ids'
import { type Money, ZERO, add, subtract } from './money'
import { type BalanceDelta, type Transaction, balanceDeltas } from './transactions'

export type Balances = ReadonlyMap<AccountId, Money>

/** Balances before any movement. An account that did not exist yet on `asOf` counts as zero. */
export function openingBalances(accounts: readonly Account[], asOf?: LocalDate): Balances {
  const balances = new Map<AccountId, Money>()
  for (const account of accounts) {
    invariant(!balances.has(account.id), `Cuenta repetida: ${account.id}`)
    const exists = asOf === undefined || account.openingDate <= asOf
    balances.set(account.id, exists ? account.openingBalance : ZERO)
  }
  return balances
}

function shift(target: Map<AccountId, Money>, deltas: readonly BalanceDelta[], direction: 1 | -1): void {
  for (const { accountId, delta } of deltas) {
    const current = target.get(accountId)
    invariant(current !== undefined, `El movimiento usa una cuenta que no existe: ${accountId}`)
    target.set(accountId, direction === 1 ? add(current, delta) : subtract(current, delta))
  }
}

/** Incremental update: the balances after registering one more movement. */
export function applyTransaction(balances: Balances, transaction: Transaction): Balances {
  const next = new Map(balances)
  shift(next, balanceDeltas(transaction), 1)
  return next
}

/** The exact inverse of `applyTransaction`: the balances as if the movement had never happened. */
export function revertTransaction(balances: Balances, transaction: Transaction): Balances {
  const next = new Map(balances)
  shift(next, balanceDeltas(transaction), -1)
  return next
}

/**
 * Recomputes every balance from the complete history. With `asOf`, only movements dated on or
 * before that day count: a movement dated in the future is not confirmed balance yet.
 */
export function balancesFromHistory(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
  asOf?: LocalDate,
): Balances {
  const balances = new Map(openingBalances(accounts, asOf))
  for (const transaction of transactions) {
    if (asOf !== undefined && transaction.date > asOf) {
      continue
    }
    shift(balances, balanceDeltas(transaction), 1)
  }
  return balances
}

/** Magnitude 1: the balance of one account. */
export function accountBalance(balances: Balances, accountId: AccountId): Money {
  const balance = balances.get(accountId)
  invariant(balance !== undefined, `La cuenta no existe: ${accountId}`)
  return balance
}

export function balanceByClass(accounts: readonly Account[], balances: Balances, wanted: AccountClass): Money {
  let total = ZERO
  for (const account of accounts) {
    if (accountClass(account.kind) === wanted) {
      total = add(total, accountBalance(balances, account.id))
    }
  }
  return total
}

/** Confirmed spendable balance: cash and current accounts. Savings and cards are left out. */
export function liquidBalance(accounts: readonly Account[], balances: Balances): Money {
  return balanceByClass(accounts, balances, 'liquid')
}

/**
 * Magnitude 2: total registered balance. The money held in own accounts (liquid plus savings).
 * Credit cards are debts, not balance: they appear in net worth.
 */
export function totalRegisteredBalance(accounts: readonly Account[], balances: Balances): Money {
  return add(balanceByClass(accounts, balances, 'liquid'), balanceByClass(accounts, balances, 'savings'))
}
