import type { LocalDate } from './dates'
import { invariant } from './errors'
import type { AccountId } from './ids'
import type { Money } from './money'

export type AccountKind = 'cash' | 'checking' | 'savings' | 'credit_card'

/**
 * - `liquid`: money that can be spent today (cash, current account).
 * - `savings`: money set apart in a savings account. It is an asset but not spendable balance.
 * - `liability`: a credit card. Its balance is zero or negative: what is owed.
 */
export type AccountClass = 'liquid' | 'savings' | 'liability'

export interface Account {
  readonly id: AccountId
  readonly name: string
  readonly kind: AccountKind
  /** Balance on `openingDate`, before any registered movement. Negative for a card with debt. */
  readonly openingBalance: Money
  readonly openingDate: LocalDate
  /** Credit cards only: day of the month (1–31) on which the bill is paid. */
  readonly paymentDay?: number
  /**
   * Credit cards only: day of the month (1–31) on which the statement closes. A purchase made after
   * it goes into the following bill. When unknown, every purchase is assumed to fall into the very
   * next bill, which is the cautious reading.
   */
  readonly statementDay?: number
  /** Hidden from the lists. Its balance still counts: archiving never makes money disappear. */
  readonly archived: boolean
}

export function accountClass(kind: AccountKind): AccountClass {
  switch (kind) {
    case 'cash':
    case 'checking':
      return 'liquid'
    case 'savings':
      return 'savings'
    case 'credit_card':
      return 'liability'
  }
}

export function isAsset(account: Account): boolean {
  return accountClass(account.kind) !== 'liability'
}

export type AccountIndex = ReadonlyMap<AccountId, Account>

export function indexAccounts(accounts: readonly Account[]): AccountIndex {
  const index = new Map<AccountId, Account>()
  for (const account of accounts) {
    invariant(!index.has(account.id), `Cuenta repetida: ${account.id}`)
    index.set(account.id, account)
  }
  return index
}

export function requireAccount(index: AccountIndex, accountId: AccountId): Account {
  const account = index.get(accountId)
  invariant(account !== undefined, `La cuenta no existe: ${accountId}`)
  return account
}

function validateCardDay(account: Account, day: number | undefined, label: string): void {
  if (day === undefined) {
    return
  }
  invariant(account.kind === 'credit_card', `Solo una tarjeta de crédito tiene día de ${label}`)
  invariant(Number.isInteger(day) && day >= 1 && day <= 31, `Día de ${label} inválido: ${String(day)}`)
}

export function validateAccount(account: Account): void {
  invariant(account.name.trim().length > 0, 'La cuenta necesita un nombre')
  validateCardDay(account, account.paymentDay, 'pago')
  validateCardDay(account, account.statementDay, 'facturación')
  invariant(
    account.statementDay === undefined || account.paymentDay !== undefined,
    'Una tarjeta con día de facturación necesita también día de pago',
  )
}
