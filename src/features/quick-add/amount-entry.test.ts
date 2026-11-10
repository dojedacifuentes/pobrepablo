import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { formatCLP } from '@/domain'
import { type KeypadKey, MAX_DIGITS, amountOf, keyFromKeyboard, pressKey } from './amount-entry'

const type = (keys: readonly KeypadKey[], start = ''): string => keys.reduce(pressKey, start)

describe('teclado de montos', () => {
  it('escribe pesos enteros, dígito a dígito', () => {
    expect(amountOf(type(['3', '5', '9', '9', '0']))).toBe(35_990)
    expect(formatCLP(amountOf(type(['1', '2', '5', '0', '000'])))).toBe('$1.250.000')
  })

  it('nada escrito es monto cero', () => {
    expect(amountOf('')).toBe(0)
  })

  it('los ceros a la izquierda no cuentan', () => {
    expect(type(['0'])).toBe('')
    expect(type(['000'])).toBe('')
    expect(type(['0', '0', '7'])).toBe('7')
    expect(type(['5', '0'])).toBe('50')
  })

  it('borrar quita el último dígito, y borrar sin nada no hace nada', () => {
    expect(type(['1', '2', '3', 'backspace'])).toBe('12')
    expect(type(['backspace'])).toBe('')
    expect(type(['7', 'backspace', 'backspace'])).toBe('')
  })

  it('no acepta más de doce dígitos: la tecla de más se ignora entera', () => {
    const full = '9'.repeat(MAX_DIGITS)
    expect(pressKey(full, '1')).toBe(full)
    expect(pressKey('9'.repeat(MAX_DIGITS - 2), '000')).toBe('9'.repeat(MAX_DIGITS - 2))
    expect(amountOf(full)).toBe(999_999_999_999)
  })

  it('para cualquier secuencia de teclas, el resultado es siempre un monto entero y válido', () => {
    const arbKey = fc.constantFrom<KeypadKey>('0', '1', '2', '5', '9', '000', 'backspace')
    fc.assert(
      fc.property(fc.array(arbKey, { maxLength: 40 }), (keys) => {
        const digits = type(keys)
        expect(digits).toMatch(/^([1-9]\d*)?$/)
        expect(digits.length).toBeLessThanOrEqual(MAX_DIGITS)
        const amount = amountOf(digits)
        expect(Number.isSafeInteger(amount)).toBe(true)
        expect(amount).toBeGreaterThanOrEqual(0)
      }),
    )
  })

  it('el teclado físico escribe lo mismo; lo demás se ignora', () => {
    expect(keyFromKeyboard('7')).toBe('7')
    expect(keyFromKeyboard('Backspace')).toBe('backspace')
    for (const key of ['.', ',', '-', 'e', 'Enter', ' ', '12']) {
      expect(keyFromKeyboard(key)).toBeNull()
    }
  })
})
