import type { DataTable } from './records'

type AnyRow = Readonly<Record<string, unknown>>

/** How each table identifies a row: a single field or a pair of fields. */
const KEY_FIELDS: Readonly<Record<DataTable, readonly [string] | readonly [string, string]>> = {
  accounts: ['id'],
  categories: ['id'],
  transactions: ['id'],
  rules: ['id'],
  cancelledOccurrences: ['ruleId', 'dueDate'],
  coverages: ['ruleId', 'dueDate'],
  budgets: ['categoryId', 'month'],
  goals: ['id'],
  reservations: ['id'],
  members: ['id'],
  sharedExpenses: ['id'],
  settlements: ['id'],
  settings: ['key'],
}

export function primaryKeyOf(table: DataTable, row: AnyRow): string | [string, string] {
  const fields = KEY_FIELDS[table]
  const first = String(row[fields[0]])
  return fields.length === 1 ? first : [first, String(row[fields[1]])]
}

/** The key of a row as one readable text, for the audit trail and for sorting. */
export function keyText(table: DataTable, row: AnyRow): string {
  const key = primaryKeyOf(table, row)
  return typeof key === 'string' ? key : key.join('|')
}

/** Rows in the stable order of their keys: two exports of the same data are byte for byte equal. */
export function sortedByKey<T extends object>(table: DataTable, rows: readonly T[]): T[] {
  return rows
    .map((row) => ({ row, key: keyText(table, row as AnyRow) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((entry) => entry.row)
}
