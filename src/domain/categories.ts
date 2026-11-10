import { type CategoryId, toId } from './ids'

export interface Category {
  readonly id: CategoryId
  readonly kind: 'expense' | 'income'
  readonly name: string
  /**
   * Health, veterinary care, emergencies and debts: the narrator never jokes about these.
   * The financial calculations ignore this flag.
   */
  readonly sensitive: boolean
  readonly archived: boolean
}

function category(id: string, kind: Category['kind'], name: string, sensitive = false): Category {
  return { id: toId(id), kind, name, sensitive, archived: false }
}

/**
 * The categories every profile starts with. Their ids are fixed words, the same on every phone,
 * so that shared household expenses land in the same category on both sides.
 */
export const DEFAULT_CATEGORIES: readonly Category[] = [
  category('arriendo', 'expense', 'Arriendo'),
  category('luz', 'expense', 'Luz'),
  category('agua', 'expense', 'Agua'),
  category('internet', 'expense', 'Internet'),
  category('supermercado', 'expense', 'Supermercado'),
  category('mascotas', 'expense', 'Mascotas'),
  category('veterinario', 'expense', 'Veterinario', true),
  category('transporte', 'expense', 'Transporte'),
  category('suscripciones', 'expense', 'Suscripciones'),
  category('salud', 'expense', 'Salud', true),
  category('ocio', 'expense', 'Ocio'),
  category('compras', 'expense', 'Compras'),
  category('deudas', 'expense', 'Deudas', true),
  category('emergencias', 'expense', 'Emergencias', true),
  category('otros-gastos', 'expense', 'Otros'),
  category('sueldo', 'income', 'Sueldo'),
  category('honorarios', 'income', 'Honorarios'),
  category('proyecto', 'income', 'Proyecto'),
  category('ocasional', 'income', 'Ocasional'),
  category('reembolso', 'income', 'Reembolso'),
  category('otros-ingresos', 'income', 'Otros'),
]
