import { type AccountId, type CategoryId, accountIdsOf, validateAccount } from '@/domain'
import { DataError } from '../../errors'
import type { AccountEdit, CategoryEdit, CommandOptions, NewAccount, NewCategory } from '../../ports'
import { accountSchema, categorySchema } from '../../schemas'
import { categoryEditSchema, parseInput } from '../../validation'
import { type StoreContext, commit } from '../unit-of-work'
import { found, notInFuture, withoutMeta } from './support'

export function createAccount(context: StoreContext, input: NewAccount, options?: CommandOptions) {
  return commit(context, 'account.create', options, input, async (unit) => {
    const account = parseInput(accountSchema, { ...input, id: input.id ?? unit.newId(), archived: false })
    validateAccount(account)
    notInFuture(account.openingDate, unit.today, 'El saldo inicial')
    await unit.create('accounts', account)
    return { accountId: account.id }
  })
}

export function updateAccount(context: StoreContext, id: AccountId, edit: AccountEdit, options?: CommandOptions) {
  return commit(context, 'account.update', options, { id, edit }, async (unit) => {
    const before = await found(unit.db.accounts.get(id), 'La cuenta no existe.')
    const next = parseInput(accountSchema, { ...withoutMeta(before), ...edit, id: before.id, kind: before.kind })
    validateAccount(next)
    notInFuture(next.openingDate, unit.today, 'El saldo inicial')
    if (next.openingDate > before.openingDate) {
      // The opening balance says «everything before this day is already included».
      const earlier = (await unit.read.transactions({ to: next.openingDate })).some(
        (transaction) =>
          !transaction.voided && transaction.date < next.openingDate && accountIdsOf(transaction).includes(id),
      )
      if (earlier) {
        throw new DataError(
          'conflict',
          'Hay movimientos de esta cuenta anteriores a esa fecha: el saldo inicial no puede empezar después de ellos.',
        )
      }
    }
    await unit.replace('accounts', before, next)
    return { accountId: id }
  })
}

export function createCategory(context: StoreContext, input: NewCategory, options?: CommandOptions) {
  return commit(context, 'category.create', options, input, async (unit) => {
    const category = parseInput(categorySchema, { ...input, id: input.id ?? unit.newId(), archived: false })
    if (category.name.trim().length === 0) {
      throw new DataError('invalid_input', 'La categoría necesita un nombre.')
    }
    await unit.create('categories', category)
    return { categoryId: category.id }
  })
}

export function updateCategory(
  context: StoreContext,
  id: CategoryId,
  edit: CategoryEdit,
  options?: CommandOptions,
) {
  return commit(context, 'category.update', options, { id, edit }, async (unit) => {
    const before = await found(unit.db.categories.get(id), 'La categoría no existe.')
    // The kind never changes: the movements already filed under it depend on it.
    const changes = parseInput(categoryEditSchema, edit)
    const next = parseInput(categorySchema, { ...withoutMeta(before), ...changes })
    if (next.name.trim().length === 0) {
      throw new DataError('invalid_input', 'La categoría necesita un nombre.')
    }
    await unit.replace('categories', before, next)
    return { categoryId: id }
  })
}
