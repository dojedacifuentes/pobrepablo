import { createContext, useContext } from 'react'
import { type Money, formatCLP } from '@/domain'

/** «Ocultar montos»: when true, every amount of the app is replaced by dots. */
const HiddenAmountsContext = createContext(false)

export const HiddenAmountsProvider = HiddenAmountsContext.Provider

export function useAmountsHidden(): boolean {
  return useContext(HiddenAmountsContext)
}

const MASK = '$ •••••'

type Tone = 'ink' | 'muted' | 'positive' | 'danger' | 'amber'

const TONES: Readonly<Record<Tone, string>> = {
  ink: 'text-ink',
  muted: 'text-muted',
  positive: 'text-positive',
  danger: 'text-danger',
  amber: 'text-amber',
}

interface AmountProps {
  readonly value: Money
  readonly tone?: Tone
  /** Shows «+» in front of a positive amount: for income in a list. */
  readonly signed?: boolean
  readonly className?: string
}

/**
 * An amount of money. Always formatted by the domain (`$1.250.000`), always with tabular figures,
 * never wrapped. The interface shows amounts; it never computes them.
 */
export function Amount({ value, tone = 'ink', signed = false, className = '' }: AmountProps) {
  const hidden = useAmountsHidden()
  if (hidden) {
    return (
      <span className={`money ${TONES[tone]} ${className}`} aria-label="Monto oculto">
        {MASK}
      </span>
    )
  }
  const text = `${signed && value > 0 ? '+' : ''}${formatCLP(value)}`
  return <span className={`money ${TONES[tone]} ${className}`}>{text}</span>
}

/**
 * How wide one character of an amount is, in ems. Inter's tabular digit is 0,648 em (ADR 0002);
 * the dots are narrower, so this slightly overestimates and the text always fits.
 */
const CHARACTER_EM = 0.66

interface FitAmountProps {
  readonly value: Money
  readonly tone?: Tone
  /** The size the figure has when there is room for it: any CSS length (`3.25rem`, `var(--x)`). */
  readonly max: string
  readonly align?: 'start' | 'center'
  readonly className?: string
  /** Shown instead of the amount, greyed: the «$0» of an empty form. */
  readonly placeholder?: boolean
}

/**
 * A big amount that is never cut: it takes the size it was given while it fits, and shrinks just
 * enough when the figure is long or the screen narrow. It measures against its own container, so
 * it behaves the same in the hero of the dashboard and inside a sheet.
 */
export function FitAmount({
  value,
  tone = 'ink',
  max,
  align = 'start',
  className = '',
  placeholder = false,
}: FitAmountProps) {
  const hidden = useAmountsHidden()
  const text = hidden ? MASK : formatCLP(value)
  const fontSize = `min(${max}, calc(100cqw / ${(text.length * CHARACTER_EM).toFixed(2)}))`
  return (
    <span className="block w-full [container-type:inline-size]">
      <span
        className={`money block leading-[1.1] ${align === 'center' ? 'text-center' : ''} ${
          placeholder ? 'text-muted/60' : TONES[tone]
        } ${className}`}
        style={{ fontSize }}
        {...(hidden ? { 'aria-label': 'Monto oculto' } : {})}
      >
        {text}
      </span>
    </span>
  )
}
