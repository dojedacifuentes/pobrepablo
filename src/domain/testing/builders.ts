import type { Account, AccountKind } from '../accounts'
import { type LocalDate, localDate } from '../dates'
import type { Goal, GoalReservation } from '../goals'
import type { Settlement, SharedExpense } from '../household'
import { type AccountId, type CategoryId, type MemberId, toId } from '../ids'
import { type Money, money } from '../money'
import type { RecurringRule } from '../recurring'
import { type Share, equalShares } from '../split'
import type { Adjustment, Expense, Income, SettlementMovement, SharedPayment, Transfer } from '../transactions'

/** Short builders for tests. Every figure in the tests is invented. */

export const d = (text: string): LocalDate => localDate(text)
export const clp = (value: number): Money => money(value)
export const cat = (id: string): CategoryId => toId(id)

export const CASH: AccountId = toId('cash')
export const CHECKING: AccountId = toId('checking')
export const SAVINGS: AccountId = toId('savings')
export const CARD: AccountId = toId('card')

export const DIEGO: MemberId = toId('diego')
export const PABLO: MemberId = toId('pablo')
export const MEMBERS: readonly MemberId[] = [DIEGO, PABLO]

export const OPENING = '2026-01-01'
export const CARD_PAYMENT_DAY = 5

export function account(
  id: AccountId,
  kind: AccountKind,
  openingBalance = 0,
  extra: Partial<Account> = {},
): Account {
  return {
    id,
    name: id,
    kind,
    openingBalance: money(openingBalance),
    openingDate: d(OPENING),
    archived: false,
    ...extra,
  }
}

export interface Openings {
  readonly cash?: number
  readonly checking?: number
  readonly savings?: number
  readonly card?: number
}

/** Cash, a current account, a savings account and a credit card paid on the 5th. */
export function baseAccounts(openings: Openings = {}): Account[] {
  return [
    account(CASH, 'cash', openings.cash ?? 0),
    account(CHECKING, 'checking', openings.checking ?? 0),
    account(SAVINGS, 'savings', openings.savings ?? 0),
    account(CARD, 'credit_card', openings.card ?? 0, { paymentDay: CARD_PAYMENT_DAY }),
  ]
}

export function expense(
  id: string,
  date: string,
  amount: number,
  accountId: AccountId = CHECKING,
  extra: Partial<Omit<Expense, 'kind'>> = {},
): Expense {
  return {
    kind: 'expense',
    id: toId(id),
    date: d(date),
    amount: money(amount),
    accountId,
    categoryId: cat('supermercado'),
    voided: false,
    ...extra,
  }
}

export function income(
  id: string,
  date: string,
  amount: number,
  accountId: AccountId = CHECKING,
  extra: Partial<Omit<Income, 'kind'>> = {},
): Income {
  return {
    kind: 'income',
    id: toId(id),
    date: d(date),
    amount: money(amount),
    accountId,
    categoryId: cat('sueldo'),
    voided: false,
    ...extra,
  }
}

export function transfer(
  id: string,
  date: string,
  amount: number,
  fromAccountId: AccountId,
  toAccountId: AccountId,
  extra: Partial<Omit<Transfer, 'kind'>> = {},
): Transfer {
  return {
    kind: 'transfer',
    id: toId(id),
    date: d(date),
    amount: money(amount),
    fromAccountId,
    toAccountId,
    voided: false,
    ...extra,
  }
}

export function sharedPayment(
  id: string,
  date: string,
  amount: number,
  accountId: AccountId,
  sharedExpenseId: string,
): SharedPayment {
  return {
    kind: 'shared_payment',
    id: toId(id),
    date: d(date),
    amount: money(amount),
    accountId,
    sharedExpenseId: toId(sharedExpenseId),
    voided: false,
  }
}

export function settlementMove(
  id: string,
  date: string,
  amount: number,
  accountId: AccountId,
  direction: 'paid' | 'received',
  settlementId: string,
): SettlementMovement {
  return {
    kind: 'settlement',
    id: toId(id),
    date: d(date),
    amount: money(amount),
    accountId,
    direction,
    settlementId: toId(settlementId),
    voided: false,
  }
}

export function adjustment(id: string, date: string, amount: number, accountId: AccountId): Adjustment {
  return { kind: 'adjustment', id: toId(id), date: d(date), amount: money(amount), accountId, voided: false }
}

export function sharedExpense(
  id: string,
  date: string,
  total: number,
  payerId: MemberId,
  shares: readonly Share<MemberId>[] = equalShares(MEMBERS),
  extra: Partial<SharedExpense> = {},
): SharedExpense {
  return {
    id: toId(id),
    date: d(date),
    description: id,
    categoryId: cat('supermercado'),
    total: money(total),
    payerId,
    shares,
    authorId: payerId,
    voided: false,
    ...extra,
  }
}

export function settlement(
  id: string,
  date: string,
  fromMemberId: MemberId,
  toMemberId: MemberId,
  amount: number,
  extra: Partial<Settlement> = {},
): Settlement {
  return {
    id: toId(id),
    date: d(date),
    fromMemberId,
    toMemberId,
    amount: money(amount),
    authorId: fromMemberId,
    voided: false,
    ...extra,
  }
}

export function rule(id: string, startDate: string, amount: number, extra: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: toId(id),
    kind: 'expense',
    label: id,
    amount: money(amount),
    amountIsEstimate: false,
    accountId: CHECKING,
    categoryId: cat('arriendo'),
    frequency: 'monthly',
    interval: 1,
    startDate: d(startDate),
    paused: false,
    ...extra,
  }
}

export function goal(id: string, target: number, extra: Partial<Goal> = {}): Goal {
  return { id: toId(id), name: id, target: money(target), archived: false, ...extra }
}

export function reservation(id: string, goalId: string, date: string, amount: number): GoalReservation {
  return { id: toId(id), goalId: toId(goalId), date: d(date), amount: money(amount), voided: false }
}
