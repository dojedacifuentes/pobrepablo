import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { canonicalJson, sha256Hex } from './canonical'

describe('texto canónico de un respaldo', () => {
  it('no depende del orden en que vengan los campos, a ninguna profundidad', () => {
    const one = { b: 1, a: { z: [1, { y: 2, x: 3 }], c: 'ñ' } }
    const other = { a: { c: 'ñ', z: [1, { x: 3, y: 2 }] }, b: 1 }
    expect(canonicalJson(one)).toBe(canonicalJson(other))
    expect(canonicalJson(one)).toBe('{"a":{"c":"ñ","z":[1,{"x":3,"y":2}]},"b":1}')
  })

  it('el orden de una lista sí importa', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]))
  })

  it('un campo sin valor no se escribe; un valor que JSON no puede llevar se rechaza', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}')
    expect(() => canonicalJson(undefined)).toThrow()
    expect(() => canonicalJson({ a: () => 1 })).toThrow()
  })

  it('para cualquier dato, desordenar sus campos no cambia el texto, y el texto vuelve a ser el mismo dato', () => {
    const shuffled = (value: unknown): unknown => {
      if (Array.isArray(value)) {
        return value.map(shuffled)
      }
      if (typeof value === 'object' && value !== null) {
        return Object.fromEntries(
          Object.entries(value)
            .reverse()
            .map(([key, field]) => [key, shuffled(field)]),
        )
      }
      return value
    }
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const text = canonicalJson(value)
        expect(canonicalJson(shuffled(value))).toBe(text)
        expect(canonicalJson(JSON.parse(text))).toBe(text)
      }),
    )
  })

  it('el sello es el SHA-256 del texto', async () => {
    // The well-known digest of the empty text.
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(await sha256Hex('a')).not.toBe(await sha256Hex('b'))
  })
})
