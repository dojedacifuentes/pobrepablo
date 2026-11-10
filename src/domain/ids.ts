import { invariant } from './errors'

declare const idBrand: unique symbol

/** A string identifier that cannot be mixed up with an identifier of another kind. */
export type Id<K extends string> = string & { readonly [idBrand]: K }

export type AccountId = Id<'account'>
export type TransactionId = Id<'transaction'>
export type CategoryId = Id<'category'>
export type MemberId = Id<'member'>
export type SharedExpenseId = Id<'sharedExpense'>
export type SettlementId = Id<'settlement'>
export type RuleId = Id<'rule'>
export type GoalId = Id<'goal'>
export type ReservationId = Id<'reservation'>

export function toId<K extends string>(value: string): Id<K> {
  invariant(value.length > 0, 'Un identificador no puede estar vacío')
  return value as Id<K>
}

/** Identifiers are created outside the domain (UUIDs) and injected, so that tests are deterministic. */
export interface IdGenerator {
  next(): string
}

/** Stable order by code unit. Never locale-dependent: two phones must sort alike. */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
