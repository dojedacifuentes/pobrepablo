import { z } from 'zod'
import {
  type Account,
  type Adjustment,
  type Budget,
  type Category,
  type Expense,
  type Goal,
  type GoalReservation,
  type Id,
  type Income,
  type LocalDate,
  MAX_INSTALLMENTS,
  type OccurrenceRef,
  type RecurringRule,
  type Settlement,
  type SettlementMovement,
  type SharedExpense,
  type SharedPayment,
  type Transfer,
  type YearMonth,
  localDate,
  money,
  yearMonth,
} from '@/domain'
import {
  AUDIT_OPERATIONS,
  type AuditEntry,
  type Coverage,
  DATA_TABLES,
  type Member,
  type ProfileInfo,
  type SettingRecord,
} from './records'

/**
 * The shape of everything that crosses the edge of the app: what a form sends and what a backup
 * file brings. Unknown fields are rejected, never silently dropped: a file that says more than the
 * app understands is not a file the app should guess about.
 *
 * These schemas check shapes. The accounting rules (a transfer needs two different accounts, the
 * parts of a split add up…) are checked by the domain, right after.
 */

function holds(check: () => unknown): boolean {
  try {
    check()
    return true
  } catch {
    return false
  }
}

function idSchema<K extends string>() {
  return z
    .string()
    .min(1)
    .max(120)
    .transform((value) => value as Id<K>)
}

/** Whole pesos. A decimal, a string or a number beyond the safe range is rejected. */
export const moneySchema = z.int().transform((value) => money(value))

export const localDateSchema = z
  .string()
  .refine((text) => holds(() => localDate(text)), 'Fecha inválida: se espera AAAA-MM-DD')
  .transform((text) => text as LocalDate)

export const yearMonthSchema = z
  .string()
  .refine((text) => holds(() => yearMonth(text)), 'Mes inválido: se espera AAAA-MM')
  .transform((text) => text as YearMonth)

export const instantSchema = z.iso.datetime()

const dayOfMonthSchema = z.int().min(1).max(31)
const shortText = z.string().min(1).max(120)

const accountId = idSchema<'account'>()
const transactionId = idSchema<'transaction'>()
const categoryId = idSchema<'category'>()
const memberId = idSchema<'member'>()
const sharedExpenseId = idSchema<'sharedExpense'>()
const settlementId = idSchema<'settlement'>()
const ruleId = idSchema<'rule'>()
const goalId = idSchema<'goal'>()
const reservationId = idSchema<'reservation'>()

const metaShape = { createdAt: instantSchema, updatedAt: instantSchema }

// ── Accounts and categories ──────────────────────────────────────────────────────────────────

const accountShape = {
  id: accountId,
  name: shortText,
  kind: z.enum(['cash', 'checking', 'savings', 'credit_card']),
  openingBalance: moneySchema,
  openingDate: localDateSchema,
  paymentDay: z.optional(dayOfMonthSchema),
  statementDay: z.optional(dayOfMonthSchema),
  archived: z.boolean(),
}
export const accountSchema = z.strictObject(accountShape)
export const accountRecordSchema = z.strictObject({ ...accountShape, ...metaShape })

const categoryShape = {
  id: categoryId,
  kind: z.enum(['expense', 'income']),
  name: shortText,
  sensitive: z.boolean(),
  archived: z.boolean(),
}
export const categorySchema = z.strictObject(categoryShape)
export const categoryRecordSchema = z.strictObject({ ...categoryShape, ...metaShape })

// ── Movements ────────────────────────────────────────────────────────────────────────────────

export const occurrenceRefSchema = z.strictObject({ ruleId, dueDate: localDateSchema })

const installmentPlanSchema = z.strictObject({
  count: z.int().min(1).max(MAX_INSTALLMENTS),
  firstDueDate: localDateSchema,
  dueDay: z.optional(dayOfMonthSchema),
})

const honorariumSchema = z.strictObject({ gross: moneySchema, withholding: moneySchema })

const transactionBase = {
  id: transactionId,
  date: localDateSchema,
  amount: moneySchema,
  voided: z.boolean(),
  note: z.optional(z.string().max(500)),
}

const expenseShape = {
  ...transactionBase,
  kind: z.literal('expense'),
  accountId,
  categoryId,
  installments: z.optional(installmentPlanSchema),
  occurrence: z.optional(occurrenceRefSchema),
}
const incomeShape = {
  ...transactionBase,
  kind: z.literal('income'),
  accountId,
  categoryId,
  honorarium: z.optional(honorariumSchema),
  occurrence: z.optional(occurrenceRefSchema),
}
const transferShape = {
  ...transactionBase,
  kind: z.literal('transfer'),
  fromAccountId: accountId,
  toAccountId: accountId,
  goalId: z.optional(goalId),
  occurrence: z.optional(occurrenceRefSchema),
}
const sharedPaymentShape = {
  ...transactionBase,
  kind: z.literal('shared_payment'),
  accountId,
  sharedExpenseId,
  installments: z.optional(installmentPlanSchema),
  occurrence: z.optional(occurrenceRefSchema),
}
const settlementMovementShape = {
  ...transactionBase,
  kind: z.literal('settlement'),
  accountId,
  direction: z.enum(['paid', 'received']),
  settlementId,
}
const adjustmentShape = {
  ...transactionBase,
  kind: z.literal('adjustment'),
  accountId,
}

const expenseSchema = z.strictObject(expenseShape)
const incomeSchema = z.strictObject(incomeShape)
const transferSchema = z.strictObject(transferShape)
const sharedPaymentSchema = z.strictObject(sharedPaymentShape)
const settlementMovementSchema = z.strictObject(settlementMovementShape)
const adjustmentSchema = z.strictObject(adjustmentShape)

export const transactionSchema = z.discriminatedUnion('kind', [
  expenseSchema,
  incomeSchema,
  transferSchema,
  sharedPaymentSchema,
  settlementMovementSchema,
  adjustmentSchema,
])

export const transactionRecordSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...expenseShape, ...metaShape }),
  z.strictObject({ ...incomeShape, ...metaShape }),
  z.strictObject({ ...transferShape, ...metaShape }),
  z.strictObject({ ...sharedPaymentShape, ...metaShape }),
  z.strictObject({ ...settlementMovementShape, ...metaShape }),
  z.strictObject({ ...adjustmentShape, ...metaShape }),
])

// ── Recurring rules ──────────────────────────────────────────────────────────────────────────

const ruleShape = {
  id: ruleId,
  kind: z.enum(['expense', 'income', 'transfer']),
  label: shortText,
  amount: moneySchema,
  amountIsEstimate: z.boolean(),
  accountId,
  toAccountId: z.optional(accountId),
  categoryId: z.optional(categoryId),
  frequency: z.enum(['weekly', 'monthly', 'yearly']),
  interval: z.int().min(1).max(120),
  startDate: localDateSchema,
  endDate: z.optional(localDateSchema),
  paused: z.boolean(),
}
export const ruleSchema = z.strictObject(ruleShape)
export const ruleRecordSchema = z.strictObject({ ...ruleShape, ...metaShape })

const occurrenceRefShape = { ruleId, dueDate: localDateSchema }
export const cancelledOccurrenceRecordSchema = z.strictObject({ ...occurrenceRefShape, ...metaShape })

const coverageShape = { ...occurrenceRefShape, sharedExpenseId }
export const coverageSchema = z.strictObject(coverageShape)
export const coverageRecordSchema = z.strictObject({ ...coverageShape, ...metaShape })

// ── Budgets and goals ────────────────────────────────────────────────────────────────────────

const budgetShape = {
  categoryId,
  month: yearMonthSchema,
  planned: moneySchema,
  funded: z.boolean(),
}
export const budgetSchema = z.strictObject(budgetShape)
export const budgetRecordSchema = z.strictObject({ ...budgetShape, ...metaShape })

const goalShape = {
  id: goalId,
  name: shortText,
  target: moneySchema,
  targetDate: z.optional(localDateSchema),
  archived: z.boolean(),
}
export const goalSchema = z.strictObject(goalShape)
export const goalRecordSchema = z.strictObject({ ...goalShape, ...metaShape })

const reservationShape = {
  id: reservationId,
  goalId,
  date: localDateSchema,
  amount: moneySchema,
  voided: z.boolean(),
}
export const reservationSchema = z.strictObject(reservationShape)
export const reservationRecordSchema = z.strictObject({
  ...reservationShape,
  ...metaShape,
  transferId: z.optional(transactionId),
})

// ── Household ────────────────────────────────────────────────────────────────────────────────

const memberShape = { id: memberId, name: shortText }
export const memberSchema = z.strictObject(memberShape)
export const memberRecordSchema = z.strictObject({ ...memberShape, ...metaShape })

const shareSchema = z.strictObject({ participantId: memberId, weight: z.int().min(0) })

const sharedExpenseShape = {
  id: sharedExpenseId,
  date: localDateSchema,
  description: shortText,
  categoryId,
  total: moneySchema,
  payerId: memberId,
  shares: z.array(shareSchema).min(1).max(20),
  authorId: memberId,
  voided: z.boolean(),
}
export const sharedExpenseSchema = z.strictObject(sharedExpenseShape)
export const sharedExpenseRecordSchema = z.strictObject({ ...sharedExpenseShape, ...metaShape })

const settlementShape = {
  id: settlementId,
  date: localDateSchema,
  fromMemberId: memberId,
  toMemberId: memberId,
  amount: moneySchema,
  authorId: memberId,
  voided: z.boolean(),
}
export const settlementSchema = z.strictObject(settlementShape)
export const settlementRecordSchema = z.strictObject({ ...settlementShape, ...metaShape })

// ── Profile, settings and audit ──────────────────────────────────────────────────────────────

export const profileInfoSchema = z.strictObject({
  key: z.literal('profile'),
  id: z.enum(['pablo', 'diego', 'demo']),
  kind: z.enum(['personal', 'demo']),
  name: shortText,
  memberId,
  startedOn: localDateSchema,
  createdAt: instantSchema,
})

const jsonObjectSchema = z.record(z.string(), z.json())

export const settingRecordSchema = z.strictObject({
  key: shortText,
  value: z.json(),
  updatedAt: instantSchema,
})

const auditChangeSchema = z.strictObject({
  table: z.enum([...DATA_TABLES, 'meta']),
  key: z.string().min(1).max(300),
  action: z.enum(['create', 'update', 'void', 'remove']),
  before: z.optional(jsonObjectSchema),
  after: z.optional(jsonObjectSchema),
  changed: z.optional(z.array(z.string())),
})

export const auditEntrySchema = z.strictObject({
  seq: z.int().min(1),
  at: instantSchema,
  operation: z.enum(AUDIT_OPERATIONS),
  idempotencyKey: z.optional(z.string().min(1).max(120)),
  fingerprint: z.optional(z.string().min(1).max(40)),
  changes: z.array(auditChangeSchema),
  result: z.optional(z.json()),
})

/** Everything a backup contains. The same shape is used to check what is about to be exported. */
export const profileSnapshotSchema = z.strictObject({
  meta: profileInfoSchema,
  accounts: z.array(accountRecordSchema),
  categories: z.array(categoryRecordSchema),
  transactions: z.array(transactionRecordSchema),
  rules: z.array(ruleRecordSchema),
  cancelledOccurrences: z.array(cancelledOccurrenceRecordSchema),
  coverages: z.array(coverageRecordSchema),
  budgets: z.array(budgetRecordSchema),
  goals: z.array(goalRecordSchema),
  reservations: z.array(reservationRecordSchema),
  members: z.array(memberRecordSchema),
  sharedExpenses: z.array(sharedExpenseRecordSchema),
  settlements: z.array(settlementRecordSchema),
  settings: z.array(settingRecordSchema),
  audit: z.array(auditEntrySchema),
})

/** One readable line per problem, naming where in the data it is. */
export function describeIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 20).map((issue) => {
    const where = issue.path.map(String).join('.')
    return where.length > 0 ? `${where}: ${issue.message}` : issue.message
  })
}

// ── The schemas must describe exactly the types of the domain ────────────────────────────────

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
/** Drops `readonly` at every depth: a parsed array is as good as a read-only one. */
type Writable<T> = T extends string | number | boolean | null | undefined
  ? T
  : T extends readonly (infer Item)[]
    ? Writable<Item>[]
    : { -readonly [Key in keyof T]: Writable<T[Key]> }
/** Same type and same set of fields: a field forgotten in a schema fails to compile here. */
type Exact<A, B> =
  Same<Writable<A>, Writable<B>> extends true ? Same<keyof A, keyof B> : false
type Out<S extends z.ZodType> = z.output<S>
type Assert<T extends true> = T

export type SchemaChecks = [
  Assert<Exact<Out<typeof accountSchema>, Account>>,
  Assert<Exact<Out<typeof categorySchema>, Category>>,
  Assert<Exact<Out<typeof expenseSchema>, Expense>>,
  Assert<Exact<Out<typeof incomeSchema>, Income>>,
  Assert<Exact<Out<typeof transferSchema>, Transfer>>,
  Assert<Exact<Out<typeof sharedPaymentSchema>, SharedPayment>>,
  Assert<Exact<Out<typeof settlementMovementSchema>, SettlementMovement>>,
  Assert<Exact<Out<typeof adjustmentSchema>, Adjustment>>,
  Assert<Exact<Out<typeof ruleSchema>, RecurringRule>>,
  Assert<Exact<Out<typeof occurrenceRefSchema>, OccurrenceRef>>,
  Assert<Exact<Out<typeof coverageSchema>, Coverage>>,
  Assert<Exact<Out<typeof budgetSchema>, Budget>>,
  Assert<Exact<Out<typeof goalSchema>, Goal>>,
  Assert<Exact<Out<typeof reservationSchema>, GoalReservation>>,
  Assert<Exact<Out<typeof memberSchema>, Member>>,
  Assert<Exact<Out<typeof sharedExpenseSchema>, SharedExpense>>,
  Assert<Exact<Out<typeof settlementSchema>, Settlement>>,
  Assert<Exact<Out<typeof profileInfoSchema>, ProfileInfo>>,
  Assert<Exact<Out<typeof settingRecordSchema>, SettingRecord>>,
  Assert<Exact<Out<typeof auditEntrySchema>, AuditEntry>>,
]
