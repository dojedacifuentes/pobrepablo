import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DomainError } from './errors'
import { ZERO, add, atLeastZero, formatCLP, money, mulDivFloor, negate, parseCLP, subtract, sum } from './money'

describe('money', () => {
  it('solo acepta enteros de pesos', () => {
    expect(money(1250000)).toBe(1250000)
    for (const invalid of [0.5, 1999.99, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => money(invalid)).toThrow(DomainError)
    }
  })

  it('normaliza el cero negativo', () => {
    expect(Object.is(money(-0), 0)).toBe(true)
    expect(Object.is(negate(ZERO), 0)).toBe(true)
  })

  it('suma, resta y niega sin perder un peso', () => {
    expect(add(money(999_999_999_999), money(1))).toBe(1_000_000_000_000)
    expect(subtract(money(100), money(250))).toBe(-150)
    expect(negate(money(2000))).toBe(-2000)
    expect(sum([money(1), money(2), money(3)])).toBe(6)
    expect(sum([])).toBe(0)
    expect(atLeastZero(money(-5))).toBe(0)
  })

  it('rechaza un resultado que ya no se puede representar con exactitud', () => {
    expect(() => add(money(Number.MAX_SAFE_INTEGER), money(1))).toThrow(DomainError)
  })

  it('mulDivFloor es exacto con montos grandes y redondea hacia abajo', () => {
    expect(mulDivFloor(money(9_000_000_000_000), 9_999, 10_000)).toBe(8_999_100_000_000)
    expect(mulDivFloor(money(100), 1, 3)).toBe(33)
    expect(mulDivFloor(money(-1), 1, 2)).toBe(-1)
    expect(() => mulDivFloor(money(100), 1, 0)).toThrow(DomainError)
  })
})

describe('formato es-CL', () => {
  it('escribe los pesos con punto de miles', () => {
    expect(formatCLP(money(0))).toBe('$0')
    expect(formatCLP(money(999))).toBe('$999')
    expect(formatCLP(money(1000))).toBe('$1.000')
    expect(formatCLP(money(1_250_000))).toBe('$1.250.000')
    expect(formatCLP(money(125_000_000))).toBe('$125.000.000')
  })

  it('pone el signo menos antes del signo peso', () => {
    expect(formatCLP(money(-1_250_000))).toBe('−$1.250.000')
  })

  it('lee lo que escribe una persona', () => {
    expect(parseCLP('$1.250.000')).toBe(1_250_000)
    expect(parseCLP(' 2.000 ')).toBe(2000)
    expect(parseCLP('1250')).toBe(1250)
    expect(parseCLP('−$500')).toBe(-500)
  })

  it('no acepta decimales ni texto', () => {
    for (const invalid of ['', '1,5', '12.5,0', 'abc', '$', '1e3', '--5']) {
      expect(parseCLP(invalid)).toBeNull()
    }
  })

  it('no adivina: un punto que no separa miles se rechaza en vez de leerse mal', () => {
    // Read naively, «1500.50» would become 150.050 pesos.
    for (const invalid of ['1500.50', '35990.00', '1.5', '1.2.3', '12.34', '1.2500', '.500', '1.']) {
      expect(parseCLP(invalid)).toBeNull()
    }
    expect(parseCLP('1.500')).toBe(1500)
    expect(parseCLP('35.990')).toBe(35_990)
    expect(parseCLP('0')).toBe(0)
    expect(parseCLP('1234567890123456')).toBeNull()
  })

  it('lo que se formatea se vuelve a leer igual', () => {
    fc.assert(
      fc.property(fc.integer({ min: -999_999_999_999_999, max: 999_999_999_999_999 }), (value) => {
        expect(parseCLP(formatCLP(money(value)))).toBe(money(value))
      }),
    )
  })
})
