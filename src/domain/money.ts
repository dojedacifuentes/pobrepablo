import { DomainError, invariant } from './errors'

declare const moneyBrand: unique symbol

/** Chilean pesos as a whole number. No decimal ever takes part in the accounting. */
export type Money = number & { readonly [moneyBrand]: true }

export function money(value: number): Money {
  if (!Number.isSafeInteger(value)) {
    throw new DomainError(`El monto debe ser un número entero de pesos: ${String(value)}`)
  }
  // Normalise -0 so that equality checks never surprise anyone.
  return (value === 0 ? 0 : value) as Money
}

export const ZERO: Money = money(0)

export function add(a: Money, b: Money): Money {
  return money(a + b)
}

export function subtract(a: Money, b: Money): Money {
  return money(a - b)
}

export function negate(a: Money): Money {
  return money(0 - a)
}

export function sum(values: Iterable<Money>): Money {
  let total = ZERO
  for (const value of values) {
    total = add(total, value)
  }
  return total
}

/** Returns the amount, or zero when it is negative. */
export function atLeastZero(a: Money): Money {
  return a < 0 ? ZERO : a
}

export function minMoney(a: Money, b: Money): Money {
  return a <= b ? a : b
}

export function maxMoney(a: Money, b: Money): Money {
  return a >= b ? a : b
}

/**
 * floor(amount × numerator / denominator), exact. The product is computed with BigInt so that large
 * amounts multiplied by weights never lose a peso to floating point.
 */
export function mulDivFloor(amount: Money, numerator: number, denominator: number): Money {
  invariant(Number.isSafeInteger(numerator) && numerator >= 0, 'El numerador debe ser un entero no negativo')
  invariant(Number.isSafeInteger(denominator) && denominator > 0, 'El denominador debe ser un entero positivo')
  const product = BigInt(amount) * BigInt(numerator)
  const divisor = BigInt(denominator)
  let quotient = product / divisor
  if (product < 0n && product % divisor !== 0n) {
    quotient -= 1n
  }
  return money(Number(quotient))
}

const MINUS_SIGN = '−'

/** es-CL format: `$1.250.000`. Negative amounts carry a real minus sign before the peso sign. */
export function formatCLP(value: Money): string {
  const digits = String(Math.abs(value))
  const groups: string[] = []
  for (let end = digits.length; end > 0; end -= 3) {
    groups.unshift(digits.slice(Math.max(0, end - 3), end))
  }
  return `${value < 0 ? MINUS_SIGN : ''}$${groups.join('.')}`
}

const MAX_DIGITS = 15

/**
 * Reads an amount typed by a person. In CLP the dot only separates thousands, so `1.250` is one
 * thousand two hundred and fifty.
 *
 * Dots are accepted only as well-formed thousands separators (groups of exactly three digits).
 * `1500.50`, `1.5` or `35990.00` look like decimals and are rejected rather than guessed: guessing
 * would turn 1.500 pesos and fifty cents into 150.050 pesos.
 */
export function parseCLP(text: string): Money | null {
  // Optional minus, optional peso sign, then plain digits or well-formed groups of thousands.
  // Spaces are allowed only around the signs, never between digits: «1 5» is not fifteen.
  const match = /^([-−])?\s*\$?\s*([1-9]\d{0,2}(?:\.\d{3})+|\d+)$/.exec(text.trim())
  if (match === null) {
    return null
  }
  const digits = (match[2] ?? '').replaceAll('.', '')
  if (digits.length === 0 || digits.length > MAX_DIGITS) {
    return null
  }
  const value = Number(digits)
  return money(match[1] === undefined ? value : 0 - value)
}
