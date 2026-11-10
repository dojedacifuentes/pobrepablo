import { type Money, ZERO, parseCLP } from '@/domain'

/**
 * Typing an amount on the keypad of the quick-add sheet. Whole pesos only: the keypad has no
 * decimal key, because the accounting has no decimals.
 *
 * The state is the digits typed so far. An empty text is «nothing typed yet», which is not the
 * same as zero pesos: the form cannot be saved until there is an amount greater than zero.
 */

export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '000' | 'backspace'

/** Up to 999.999.999.999: more than any amount a person will type, and far inside the safe range. */
export const MAX_DIGITS = 12

export function pressKey(digits: string, key: KeypadKey): string {
  if (key === 'backspace') {
    return digits.slice(0, -1)
  }
  // A leading zero means nothing: «0», «00» and «000» typed first leave the amount empty.
  const next = `${digits}${key}`.replace(/^0+/, '')
  return next.length > MAX_DIGITS ? digits : next
}

/** The amount typed, or zero when nothing was typed. */
export function amountOf(digits: string): Money {
  // The domain reads the text: the interface never builds an amount by itself.
  return parseCLP(digits) ?? ZERO
}

/** The key of the keypad that a key of a physical keyboard stands for, if any. */
export function keyFromKeyboard(key: string): KeypadKey | null {
  if (key === 'Backspace' || key === 'Delete') {
    return 'backspace'
  }
  return /^[0-9]$/.test(key) ? (key as KeypadKey) : null
}
