import { describe, expect, it } from 'vitest'
import { DomainError } from '@/domain'
import { DataError, toDataError } from './errors'

const named = (name: string, message = '', inner?: unknown) => Object.assign(new Error(message), { name, inner })

describe('errores de almacenamiento explicados', () => {
  it('sin espacio en el teléfono', () => {
    for (const error of [named('QuotaExceededError'), named('AbortError', '', named('QuotaExceededError'))]) {
      const explained = toDataError(error)
      expect(explained).toMatchObject({ code: 'storage_full' })
      expect((explained as Error).message).toContain('sin espacio')
    }
  })

  it('base de una versión más nueva, almacenamiento bloqueado, identificador repetido', () => {
    expect(toDataError(named('VersionError'))).toMatchObject({ code: 'newer_schema' })
    expect(toDataError(named('MissingAPIError'))).toMatchObject({ code: 'storage_unavailable' })
    expect(toDataError(named('OpenFailedError', '', named('InvalidStateError')))).toMatchObject({
      code: 'storage_unavailable',
    })
    expect(toDataError(named('ConstraintError'))).toMatchObject({ code: 'conflict' })
    expect(toDataError(named('ConstraintError', 'index occurrenceKey uniqueness'))).toMatchObject({
      code: 'duplicate_confirmation',
    })
  })

  it('lo que ya está explicado pasa tal cual, aunque venga envuelto', () => {
    const data = new DataError('not_found', 'No existe.')
    const domain = new DomainError('El monto debe ser mayor que cero')
    expect(toDataError(data)).toBe(data)
    expect(toDataError(named('AbortError', '', data))).toBe(data)
    expect(toDataError(named('AbortError', '', domain))).toBe(domain)
  })

  it('lo desconocido no se disfraza', () => {
    const strange = new Error('algo raro')
    expect(toDataError(strange)).toBe(strange)
    expect(toDataError('texto')).toBe('texto')
  })
})
