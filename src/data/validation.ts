import { z } from 'zod'
import { DataError } from './errors'
import { describeIssues, localDateSchema, moneySchema } from './schemas'

/** Checks what came from outside against its schema. A failure names every problem found. */
export function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new DataError('invalid_input', 'Los datos no son válidos.', describeIssues(result.error))
  }
  return result.data
}

const shortText = z.string().min(1).max(120)
const id = z.string().min(1).max(120)

/**
 * What may change on a rule in place. A calendar field (`startDate`, `frequency`, `interval`, the
 * accounts) is an unknown key here and is rejected: the calendar changes only by rescheduling.
 */
export const ruleEditSchema = z.strictObject({
  label: z.optional(shortText),
  amount: z.optional(moneySchema),
  amountIsEstimate: z.optional(z.boolean()),
  categoryId: z.optional(id),
  paused: z.optional(z.boolean()),
})

export const rescheduleSchema = z.strictObject({
  lastDayOfOld: localDateSchema,
  startDate: localDateSchema,
  id: z.optional(id),
  label: z.optional(shortText),
  amount: z.optional(moneySchema),
  amountIsEstimate: z.optional(z.boolean()),
  accountId: z.optional(id),
  toAccountId: z.optional(id),
  categoryId: z.optional(id),
  frequency: z.optional(z.enum(['weekly', 'monthly', 'yearly'])),
  interval: z.optional(z.int().min(1).max(120)),
  endDate: z.optional(localDateSchema),
})

export const categoryEditSchema = z.strictObject({
  name: z.optional(shortText),
  sensitive: z.optional(z.boolean()),
  archived: z.optional(z.boolean()),
})

export const reservationInputSchema = z.strictObject({
  goalId: id,
  amount: moneySchema,
  date: localDateSchema,
  id: z.optional(id),
})

export const fulfilInputSchema = z.strictObject({
  goalId: id,
  amount: moneySchema,
  date: localDateSchema,
  fromAccountId: id,
  toAccountId: id,
  reservationId: z.optional(id),
  transactionId: z.optional(id),
})

export const confirmInputSchema = z.strictObject({
  ref: z.strictObject({ ruleId: id, dueDate: localDateSchema }),
  date: localDateSchema,
  amount: z.optional(moneySchema),
  installments: z.optional(z.int().min(1)),
  note: z.optional(z.string().max(500)),
  transactionId: z.optional(id),
  shared: z.optional(
    z.strictObject({
      id: z.optional(id),
      description: shortText,
      shares: z.array(z.strictObject({ participantId: id, weight: z.int().min(0) })).min(1),
    }),
  ),
})

const paymentSchema = z.strictObject({
  accountId: id,
  transactionId: z.optional(id),
  installments: z.optional(z.int().min(1)),
})

export const sharedExpenseInputSchema = z.strictObject({
  id: z.optional(id),
  date: localDateSchema,
  description: shortText,
  categoryId: id,
  total: moneySchema,
  payerId: id,
  shares: z.array(z.strictObject({ participantId: id, weight: z.int().min(0) })).min(1),
  payment: z.optional(paymentSchema),
})

export const settlementInputSchema = z.strictObject({
  id: z.optional(id),
  date: localDateSchema,
  fromMemberId: id,
  toMemberId: id,
  amount: moneySchema,
  movement: z.optional(z.strictObject({ accountId: id, transactionId: z.optional(id) })),
})
