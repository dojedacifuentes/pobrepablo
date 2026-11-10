import { type Transaction, occurrenceOf } from '@/domain'
import type { JsonObject, TransactionRecord } from '../records'
import type { TransactionRow } from './database'

/**
 * The key of the unique index that stops a double confirmation. Only a live movement holds it:
 * once voided, the occurrence is free to be confirmed again.
 */
export function occurrenceKeyOf(transaction: Transaction): string | undefined {
  if (transaction.voided) {
    return undefined
  }
  const ref = occurrenceOf(transaction)
  return ref === undefined ? undefined : `${ref.ruleId}|${ref.dueDate}`
}

export function toTransactionRecord(row: TransactionRow): TransactionRecord {
  if (!('occurrenceKey' in row)) {
    return row
  }
  const copy: Record<string, unknown> = { ...row }
  delete copy.occurrenceKey
  return copy as unknown as TransactionRecord
}

export function toTransactionRow(record: TransactionRecord): TransactionRow {
  const clean = toTransactionRecord(record)
  const key = occurrenceKeyOf(clean)
  return key === undefined ? clean : { ...clean, occurrenceKey: key }
}

/** Removes the fields whose value is `undefined`, so that what is stored is what JSON can carry. */
export function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T
}

type AnyRow = Readonly<Record<string, unknown>>

/** A plain copy that JSON can carry. Rows are already plain data: this only fixes the type. */
export function toJsonObject(row: object): JsonObject {
  return JSON.parse(JSON.stringify(row)) as JsonObject
}

/** The names of the fields whose value differs between two versions of a row. */
export function changedFields(before: object, after: object): string[] {
  const left = before as AnyRow
  const right = after as AnyRow
  const names = new Set([...Object.keys(left), ...Object.keys(right)])
  names.delete('updatedAt')
  return [...names].filter((name) => JSON.stringify(left[name]) !== JSON.stringify(right[name])).sort()
}
