import {
  type LocalDate,
  type RecurringRule,
  type RuleId,
  occurrenceOf,
  requireAccount,
  rescheduleRule,
  toId,
  validateRule,
} from '@/domain'
import { DataError } from '../../errors'
import type { CommandOptions, NewRule, RescheduleInput, RuleEdit } from '../../ports'
import { localDateSchema, ruleSchema } from '../../schemas'
import { parseInput, rescheduleSchema, ruleEditSchema } from '../../validation'
import { withoutUndefined } from '../rows'
import { type StoreContext, type UnitOfWork, commit } from '../unit-of-work'
import { found, requireCategory, validationContext, withoutMeta } from './support'

/** A rule must make sense by itself and point at accounts and a category that exist. */
async function validated(unit: UnitOfWork, candidate: unknown): Promise<RecurringRule> {
  const rule = parseInput(ruleSchema, candidate)
  validateRule(rule)
  const { accounts, categories } = await validationContext(unit)
  requireAccount(accounts, rule.accountId)
  if (rule.toAccountId !== undefined) {
    requireAccount(accounts, rule.toAccountId)
  }
  if (rule.kind !== 'transfer' && rule.categoryId !== undefined) {
    requireCategory(categories, rule.categoryId, rule.kind)
  }
  return rule
}

export function createRule(context: StoreContext, input: NewRule, options?: CommandOptions) {
  return commit(context, 'rule.create', options, input, async (unit) => {
    const rule = await validated(unit, { ...input, id: input.id ?? unit.newId(), paused: false })
    await unit.create('rules', rule)
    return { ruleId: rule.id }
  })
}

export function updateRule(context: StoreContext, id: RuleId, edit: RuleEdit, options?: CommandOptions) {
  return commit(context, 'rule.update', options, { id, edit }, async (unit) => {
    const before = await found(unit.db.rules.get(id), 'El recurrente no existe.')
    // `ruleEditSchema` has no calendar field: trying to move the start date fails right here.
    const changes = withoutUndefined(parseInput(ruleEditSchema, edit))
    const next = await validated(unit, { ...withoutMeta(before), ...changes })
    await unit.replace('rules', before, next)
    return { ruleId: id }
  })
}

async function confirmedAfter(unit: UnitOfWork, ruleId: RuleId, day: LocalDate): Promise<boolean> {
  return (await unit.read.transactions()).some((transaction) => {
    const ref = transaction.voided ? undefined : occurrenceOf(transaction)
    return ref !== undefined && ref.ruleId === ruleId && ref.dueDate > day
  })
}

/**
 * After a cut, the dates of the rule that came later no longer exist. A coverage pointing at one
 * of them would be left pointing at nothing, and its shared expense could not cover anything
 * else: the cut is refused until the coverage is taken off. A skipped date past the cut means
 * nothing any more and is removed in the same operation.
 */
async function clearAfterCut(unit: UnitOfWork, ruleId: RuleId, lastDay: LocalDate): Promise<void> {
  const covered = await unit.db.coverages.where('[ruleId+dueDate]').above([ruleId, lastDay]).toArray()
  if (covered.some((coverage) => coverage.ruleId === ruleId)) {
    throw new DataError(
      'conflict',
      'Un gasto compartido cubre un pago programado posterior al corte: quita esa cobertura o elige un corte más adelante.',
    )
  }
  const skipped = await unit.db.cancelledOccurrences.where('[ruleId+dueDate]').above([ruleId, lastDay]).toArray()
  for (const occurrence of skipped) {
    if (occurrence.ruleId === ruleId) {
      await unit.remove('cancelledOccurrences', occurrence)
    }
  }
}

export function closeRule(context: StoreContext, id: RuleId, endDate: LocalDate, options?: CommandOptions) {
  return commit(context, 'rule.close', options, { id, endDate }, async (unit) => {
    const before = await found(unit.db.rules.get(id), 'El recurrente no existe.')
    const lastDay = parseInput(localDateSchema, endDate)
    if (before.endDate !== undefined && lastDay > before.endDate) {
      throw new DataError('conflict', 'Este recurrente ya había terminado antes: cerrarlo no lo alarga.')
    }
    if (await confirmedAfter(unit, id, lastDay)) {
      throw new DataError(
        'conflict',
        'Ya hay un pago confirmado para una fecha posterior al cierre: elige un cierre más adelante.',
      )
    }
    await clearAfterCut(unit, id, lastDay)
    const next = await validated(unit, { ...withoutMeta(before), endDate: lastDay })
    await unit.replace('rules', before, next)
    return { ruleId: id }
  })
}

export function rescheduleRuleCommand(
  context: StoreContext,
  id: RuleId,
  input: RescheduleInput,
  options?: CommandOptions,
) {
  return commit(context, 'rule.reschedule', options, { id, input }, async (unit) => {
    const before = await found(unit.db.rules.get(id), 'El recurrente no existe.')
    const { lastDayOfOld, id: nextId, ...change } = withoutUndefined(parseInput(rescheduleSchema, input))
    const { closed, next } = rescheduleRule(
      withoutMeta(before),
      lastDayOfOld,
      { ...(change as Partial<RecurringRule>), id: toId<'rule'>(nextId ?? unit.newId()), startDate: change.startDate },
      await unit.read.transactions(),
    )
    const replacement = await validated(unit, next)
    await clearAfterCut(unit, id, lastDayOfOld)
    await unit.replace('rules', before, closed)
    await unit.create('rules', replacement)
    return { closedRuleId: id, ruleId: replacement.id }
  })
}
