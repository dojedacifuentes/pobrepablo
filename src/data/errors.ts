import { DomainError } from '@/domain'

/**
 * Why the data layer refused to do something. The message is written for the person (Spanish,
 * no jargon); the code is for the interface to decide what to offer next.
 */
export type DataErrorCode =
  /** The record that the operation names does not exist. */
  | 'not_found'
  /** The input did not pass validation at the edge. */
  | 'invalid_input'
  /** The operation contradicts what is already stored. */
  | 'conflict'
  /** A programmed occurrence was already confirmed by another movement. */
  | 'duplicate_confirmation'
  /** The operation would leave a household record without its counterpart. */
  | 'ledger_mismatch'
  /** The record is one side of a pair and must be changed through its household operation. */
  | 'linked_record'
  /** The audit trail can only grow. */
  | 'append_only'
  /** The device ran out of space for this site. */
  | 'storage_full'
  /** The database was written by a newer version of the app. */
  | 'newer_schema'
  /** IndexedDB is missing or blocked (private mode, disabled storage). */
  | 'storage_unavailable'
  /** The profile has no data yet and was not prepared. */
  | 'not_ready'

export class DataError extends Error {
  readonly code: DataErrorCode
  /** One line per problem, when there are several (an import that fails validation). */
  readonly problems: readonly string[]

  constructor(code: DataErrorCode, message: string, problems: readonly string[] = []) {
    super(message)
    this.name = 'DataError'
    this.code = code
    this.problems = problems
  }
}

function errorNames(error: unknown): string[] {
  const names: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth += 1) {
    const { name, inner } = current as { name?: unknown; inner?: unknown }
    if (typeof name === 'string') {
      names.push(name)
    }
    current = inner
  }
  return names
}

function mentions(error: unknown, text: string): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth += 1) {
    const { message, inner } = current as { message?: unknown; inner?: unknown }
    if (typeof message === 'string' && message.includes(text)) {
      return true
    }
    current = inner
  }
  return false
}

/**
 * Whether the error (or the one Dexie wrapped) was raised by the app itself, with its reason, and
 * not by the database.
 */
export function isExplained(error: unknown): boolean {
  let wrapped: unknown = error
  for (let depth = 0; depth < 4 && typeof wrapped === 'object' && wrapped !== null; depth += 1) {
    if (wrapped instanceof DataError || wrapped instanceof DomainError) {
      return true
    }
    wrapped = (wrapped as { inner?: unknown }).inner
  }
  return false
}

/**
 * Translates what IndexedDB and Dexie throw into something the interface can explain. Anything
 * already understood (a `DataError`, a rule of the domain) passes through untouched.
 */
export function toDataError(error: unknown): unknown {
  // Dexie wraps what a table operation throws: the real reason is then in `inner`.
  let wrapped: unknown = error
  for (let depth = 0; depth < 4 && typeof wrapped === 'object' && wrapped !== null; depth += 1) {
    if (wrapped instanceof DataError || wrapped instanceof DomainError) {
      return wrapped
    }
    wrapped = (wrapped as { inner?: unknown }).inner
  }
  const names = errorNames(error)
  if (names.includes('QuotaExceededError')) {
    return new DataError(
      'storage_full',
      'El teléfono se quedó sin espacio para guardar. No se guardó este cambio: libera espacio y vuelve a intentarlo.',
    )
  }
  if (names.includes('VersionError')) {
    return new DataError(
      'newer_schema',
      'Estos datos los guardó una versión más nueva de la app. Actualiza la app antes de abrirlos.',
    )
  }
  if (names.includes('ConstraintError') && mentions(error, 'occurrenceKey')) {
    return new DataError('duplicate_confirmation', 'Este movimiento programado ya fue confirmado.')
  }
  if (names.includes('ConstraintError') && mentions(error, 'idempotencyKey')) {
    return new DataError('conflict', 'Esta operación ya se había guardado.')
  }
  if (names.includes('ConstraintError')) {
    return new DataError('conflict', 'Ya existe un registro con ese identificador.')
  }
  if (names.includes('MissingAPIError') || names.includes('InvalidStateError') || names.includes('OpenFailedError')) {
    return new DataError(
      'storage_unavailable',
      'El navegador no deja guardar datos en este momento (¿modo privado?). Nada se guardó.',
    )
  }
  return error
}
