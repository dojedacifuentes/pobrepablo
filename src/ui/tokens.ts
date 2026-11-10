/**
 * The palette of NEXO («Neo-Noir Financial Editorial», specification §7) as semantic tokens.
 *
 * The same values are declared for CSS in `styles.css`; `tokens.test.ts` checks that both agree and
 * that every pair of text and background used in the interface passes WCAG AA.
 */
export const COLORS = {
  /** Background of the app. */
  obsidian: '#080B12',
  /** Raised background: sheets, the bottom bar. */
  night: '#101827',
  /** Cards and rows. */
  surface: '#192130',
  /** A step above the surface: pressed rows, keypad keys. */
  raised: '#232D40',
  /** Main text. */
  ink: '#F4F3F0',
  /** Secondary text. */
  muted: '#9FA8B8',
  /** Positive: income, on track. */
  positive: '#46D3A5',
  /** Accent: the primary action. */
  accent: '#8779DA',
  /** Narrative and attention. */
  amber: '#D9AD67',
  /** Warning: overdue, exceeded. */
  danger: '#ED7779',
} as const

export type ColorToken = keyof typeof COLORS

/** Every text-on-background pair the interface uses. Small text needs 4.5:1; large text, 3:1. */
export const TEXT_PAIRS: readonly { text: ColorToken; background: ColorToken; large?: boolean }[] = [
  { text: 'ink', background: 'obsidian' },
  { text: 'ink', background: 'night' },
  { text: 'ink', background: 'surface' },
  { text: 'ink', background: 'raised' },
  { text: 'muted', background: 'obsidian' },
  { text: 'muted', background: 'night' },
  { text: 'muted', background: 'surface' },
  { text: 'muted', background: 'raised' },
  { text: 'positive', background: 'obsidian' },
  { text: 'positive', background: 'night' },
  { text: 'positive', background: 'surface' },
  { text: 'accent', background: 'obsidian' },
  { text: 'accent', background: 'night' },
  { text: 'accent', background: 'surface', large: true },
  { text: 'amber', background: 'obsidian' },
  { text: 'amber', background: 'night' },
  { text: 'amber', background: 'surface' },
  { text: 'danger', background: 'obsidian' },
  { text: 'danger', background: 'night' },
  { text: 'danger', background: 'surface' },
  // Text on coloured buttons is dark: light text on these colours does not reach AA.
  { text: 'obsidian', background: 'accent' },
  { text: 'obsidian', background: 'positive' },
  { text: 'obsidian', background: 'amber' },
  { text: 'obsidian', background: 'danger' },
  { text: 'obsidian', background: 'ink' },
]

function channel(value: number): number {
  const scaled = value / 255
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
}

/** Relative luminance of a `#RRGGBB` colour (WCAG 2.2). */
export function luminance(hex: string): number {
  const red = Number.parseInt(hex.slice(1, 3), 16)
  const green = Number.parseInt(hex.slice(3, 5), 16)
  const blue = Number.parseInt(hex.slice(5, 7), 16)
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
}

/** Contrast ratio between two colours, from 1 (none) to 21 (black on white). */
export function contrast(first: string, second: string): number {
  const lighter = Math.max(luminance(first), luminance(second))
  const darker = Math.min(luminance(first), luminance(second))
  return (lighter + 0.05) / (darker + 0.05)
}
