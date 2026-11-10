import type { AccountRecord, CategoryRecord, TransactionRecord } from '@/data'
import { type AccountId, type CategoryId, type Money, negate } from '@/domain'

/** How a movement is presented in a list. The amount comes signed from the domain's own figures. */
export interface MovementLine {
  readonly title: string
  readonly detail: string
  /** Signed for display: negative when money left, positive when it arrived. */
  readonly amount: Money
  readonly tone: 'ink' | 'positive' | 'muted'
  /** Income shows its «+»; a transfer shows no sign at all. */
  readonly signed: boolean
}

export interface Names {
  readonly accounts: ReadonlyMap<AccountId, string>
  readonly categories: ReadonlyMap<CategoryId, string>
}

export function namesOf(accounts: readonly AccountRecord[], categories: readonly CategoryRecord[]): Names {
  return {
    accounts: new Map(accounts.map((account) => [account.id, account.name])),
    categories: new Map(categories.map((category) => [category.id, category.name])),
  }
}

function joined(...parts: (string | undefined)[]): string {
  return parts.filter((part) => part !== undefined && part.length > 0).join(' · ')
}

export function describeMovement(transaction: TransactionRecord, names: Names): MovementLine {
  const account = (id: AccountId): string => names.accounts.get(id) ?? 'Cuenta'
  switch (transaction.kind) {
    case 'expense':
      return {
        title: names.categories.get(transaction.categoryId) ?? 'Gasto',
        detail: joined(account(transaction.accountId), transaction.note),
        amount: negate(transaction.amount),
        tone: 'ink',
        signed: false,
      }
    case 'income':
      return {
        title: names.categories.get(transaction.categoryId) ?? 'Ingreso',
        detail: joined(account(transaction.accountId), transaction.note),
        amount: transaction.amount,
        tone: 'positive',
        signed: true,
      }
    case 'transfer':
      return {
        title: 'Transferencia',
        detail: joined(`${account(transaction.fromAccountId)} → ${account(transaction.toAccountId)}`, transaction.note),
        amount: transaction.amount,
        tone: 'muted',
        signed: false,
      }
    case 'shared_payment':
      return {
        title: 'Pago de gasto compartido',
        detail: joined(transaction.note, account(transaction.accountId)),
        amount: negate(transaction.amount),
        tone: 'ink',
        signed: false,
      }
    case 'settlement':
      return {
        title: transaction.direction === 'paid' ? 'Reembolso al hogar' : 'Reembolso del hogar',
        detail: joined(transaction.note, account(transaction.accountId)),
        amount: transaction.direction === 'paid' ? negate(transaction.amount) : transaction.amount,
        tone: transaction.direction === 'paid' ? 'ink' : 'positive',
        signed: transaction.direction === 'received',
      }
    case 'adjustment':
      return {
        title: 'Ajuste de saldo',
        detail: joined(transaction.note, account(transaction.accountId)),
        amount: transaction.amount,
        tone: transaction.amount > 0 ? 'positive' : 'ink',
        signed: transaction.amount > 0,
      }
  }
}
