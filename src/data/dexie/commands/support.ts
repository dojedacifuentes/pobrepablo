import {
  type AccountIndex,
  type Category,
  type CategoryId,
  type LocalDate,
  type ValidationContext,
  indexAccounts,
} from '@/domain'
import { DataError } from '../../errors'
import type { UnitOfWork } from '../unit-of-work'

/** What every movement is validated against. The categories are always there: see the model, §15. */
export interface FullValidationContext extends ValidationContext {
  readonly accounts: AccountIndex
  readonly today: LocalDate
  readonly categories: ReadonlyMap<CategoryId, Category>
}

export async function validationContext(unit: UnitOfWork): Promise<FullValidationContext> {
  const accounts = indexAccounts(await unit.read.accounts())
  const categories = new Map((await unit.read.categories()).map((category) => [category.id, category]))
  return { accounts, categories, today: unit.today }
}

export async function found<T>(lookup: PromiseLike<T | undefined>, message: string): Promise<T> {
  const value = await lookup
  if (value === undefined) {
    throw new DataError('not_found', message)
  }
  return value
}

export function requireCategory(
  categories: ReadonlyMap<CategoryId, Category>,
  categoryId: CategoryId,
  kind: Category['kind'],
): Category {
  const category = categories.get(categoryId)
  if (category === undefined) {
    throw new DataError('not_found', 'La categoría no existe.')
  }
  if (category.kind !== kind) {
    throw new DataError(
      'invalid_input',
      kind === 'expense'
        ? `«${category.name}» es una categoría de ingreso: no sirve para un gasto.`
        : `«${category.name}» es una categoría de gasto: no sirve para un ingreso.`,
    )
  }
  return category
}

export function notInFuture(date: LocalDate, today: LocalDate, what: string): void {
  if (date > today) {
    throw new DataError('invalid_input', `${what} no puede tener fecha futura: lo que todavía no ocurre se programa.`)
  }
}

/** A stored row without its two traces: the record of the domain it carries. */
export function withoutMeta<T extends object>(row: T): Omit<T, 'createdAt' | 'updatedAt'> {
  const copy = { ...row } as Record<string, unknown>
  delete copy.createdAt
  delete copy.updatedAt
  return copy as Omit<T, 'createdAt' | 'updatedAt'>
}
