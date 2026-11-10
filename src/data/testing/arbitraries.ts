import fc from 'fast-check'
import { type RecurringRule, type Transaction, localDate } from '@/domain'
import { arbSnapshotInput } from '@/domain/testing/arbitraries'
import { DIEGO, cat } from '@/domain/testing/builders'
import { sortedByKey } from '../keys'
import { profileDescriptor } from '../profiles'
import type { AuditEntry, Coverage, JsonValue, ProfileSnapshot, SettingRecord } from '../records'
import { emptyProfile } from '../seed'

const NOW = '2026-11-10T12:00:00.000Z'
const stamp = { createdAt: NOW, updatedAt: NOW }

const arbSettings: fc.Arbitrary<SettingRecord[]> = fc
  .uniqueArray(fc.constantFrom('humor', 'montos-ocultos', 'ultimo-espacio'), { maxLength: 3 })
  .chain((keys) =>
    fc.tuple(
      ...keys.map((key) =>
        fc
          .oneof<fc.Arbitrary<JsonValue>[]>(fc.boolean(), fc.constantFrom('serio', 'narrativo', 'discreto'), fc.constant<JsonValue>({ anidado: [1, 'dos', null] }))
          .map((value): SettingRecord => ({ key, value, updatedAt: NOW })),
      ),
    ),
  )

/**
 * Later operations of the trail, as the store writes them: with the rows they touched (how each
 * was and how it ended up), and sometimes with the key and the fingerprint of a form.
 */
const arbAudit: fc.Arbitrary<AuditEntry[]> = fc
  .array(
    fc.record({
      operation: fc.constantFrom('transaction.create' as const, 'transaction.edit' as const, 'transaction.void' as const),
      keyed: fc.boolean(),
      amount: fc.integer({ min: 1, max: 900_000 }),
    }),
    { maxLength: 5 },
  )
  .map((entries) =>
    entries.map(({ operation, keyed, amount }, index): AuditEntry => {
      const row = { id: `t${String(index)}`, kind: 'expense', amount, voided: false, note: 'prueba «ñ»' }
      return {
        seq: index + 2,
        at: NOW,
        operation,
        ...(keyed ? { idempotencyKey: `clave-${String(index)}`, fingerprint: `0000abcd-${String(index)}` } : {}),
        changes: [
          operation === 'transaction.create'
            ? { table: 'transactions', key: row.id, action: 'create', after: row }
            : {
                table: 'transactions',
                key: row.id,
                action: operation === 'transaction.void' ? 'void' : 'update',
                before: row,
                after: { ...row, voided: operation === 'transaction.void', amount: amount + 1 },
                changed: ['amount', 'voided'],
              },
        ],
        result: { transactionId: row.id },
      }
    }),
  )

/**
 * Everything a profile can hold, random but valid: the whole-situation generator of the domain
 * (accounts, movements dated before and after «today», confirmed and skipped occurrences, budgets,
 * goals, a household) dressed as it is stored, plus coverages, settings and an audit trail.
 *
 * The domain's generator is looser than what the app accepts in a file, so three things are put
 * right here: an income rule gets an income category, and a reservation or a goal transfer only
 * stays if its goal exists.
 */
export const arbProfileSnapshot: fc.Arbitrary<ProfileSnapshot> = fc
  .record({ input: arbSnapshotInput, settings: arbSettings, audit: arbAudit, covered: fc.nat({ max: 2 }) })
  .map(({ input, settings, audit, covered }): ProfileSnapshot => {
    const profile = profileDescriptor(input.household?.memberId === DIEGO ? 'diego' : 'pablo')
    const base = emptyProfile(profile, localDate('2026-01-01'), NOW)
    const stamped = <T extends object>(rows: readonly T[]) => rows.map((row) => ({ ...row, ...stamp }))

    const goalIds = new Set<string>(input.goals.map((goal) => goal.id))
    const rules = input.rules.map(
      (rule): RecurringRule => (rule.kind === 'income' ? { ...rule, categoryId: cat('sueldo') } : rule),
    )
    const transactions = input.transactions.map((transaction): Transaction => {
      if (transaction.kind !== 'transfer' || transaction.goalId === undefined || goalIds.has(transaction.goalId)) {
        return transaction
      }
      const copy: Record<string, unknown> = { ...transaction }
      delete copy.goalId
      return copy as unknown as Transaction
    })
    const reservations = input.reservations.filter((reservation) => goalIds.has(reservation.goalId))

    // «This shared expense is that programmed expense»: one per rule and per expense at most.
    const expenses = input.household?.expenses ?? []
    const coverages: Coverage[] = rules
      .filter((rule) => rule.kind === 'expense')
      .slice(0, Math.min(covered, expenses.length))
      .flatMap((rule, index) => {
        const expense = expenses[index]
        return expense === undefined ? [] : [{ ruleId: rule.id, dueDate: rule.startDate, sharedExpenseId: expense.id }]
      })

    return {
      ...base,
      accounts: sortedByKey('accounts', stamped(input.accounts)),
      transactions: sortedByKey('transactions', stamped(transactions)),
      rules: sortedByKey('rules', stamped(rules)),
      cancelledOccurrences: sortedByKey('cancelledOccurrences', stamped(input.cancelledOccurrences)),
      coverages: sortedByKey('coverages', stamped(coverages)),
      budgets: sortedByKey('budgets', stamped(input.budgets)),
      goals: sortedByKey('goals', stamped(input.goals)),
      reservations: sortedByKey('reservations', stamped(reservations)),
      sharedExpenses: sortedByKey('sharedExpenses', stamped(expenses)),
      settlements: sortedByKey('settlements', stamped(input.household?.settlements ?? [])),
      settings: sortedByKey('settings', settings),
      audit: [...base.audit, ...audit],
    }
  })
