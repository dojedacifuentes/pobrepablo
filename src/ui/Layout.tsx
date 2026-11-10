import type { ReactNode } from 'react'

/** A block of the page with its small title and, sometimes, one action on the right. */
export function Section({
  title,
  action,
  children,
}: {
  readonly title: string
  readonly action?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex min-h-6 items-center justify-between">
        <h2 className="eyebrow">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

/** An opaque card. Lists and forms sit on these: the glass is kept for the hero and the bars. */
export function Card({ children, className = '' }: { readonly children: ReactNode; readonly className?: string }) {
  return <div className={`rounded-card border border-line bg-surface ${className}`}>{children}</div>
}

/** What a screen says when there is nothing to show yet: what it is for, and the next step. */
export function EmptyState({
  title,
  children,
  action,
}: {
  readonly title: string
  readonly children: ReactNode
  readonly action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-card border border-dashed border-line-strong px-4 py-5">
      <p className="font-serif text-2xl leading-7 text-ink">{title}</p>
      <p className="text-sm leading-6 text-muted">{children}</p>
      {action}
    </div>
  )
}

type BarTone = 'positive' | 'amber' | 'danger' | 'accent'

const BAR_TONES: Readonly<Record<BarTone, string>> = {
  positive: 'bg-positive',
  amber: 'bg-amber',
  danger: 'bg-danger',
  accent: 'bg-accent',
}

/**
 * A progress bar. It is decoration for the eyes only: the figures it stands for are always
 * written next to it, so colour is never the only carrier of meaning.
 */
export function ProgressBar({ percent, tone }: { readonly percent: number; readonly tone: BarTone }) {
  const width = Math.max(0, Math.min(100, percent))
  return (
    <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-raised">
      <div className={`h-full rounded-full ${BAR_TONES[tone]}`} style={{ width: `${String(width)}%` }} />
    </div>
  )
}

/** A choice among a few, all visible: gasto · ingreso · transferencia. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string
  readonly value: T
  readonly options: readonly { readonly value: T; readonly label: string }[]
  readonly onChange: (value: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-xl bg-obsidian p-0.5">
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`min-h-11 min-w-0 flex-1 rounded-[10px] px-1 text-[0.8125rem] font-medium min-[360px]:text-sm transition-colors duration-150 ${
              selected ? 'bg-raised text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)]' : 'text-muted'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** A choice that can be tapped: a category, an account. */
export function Chip({
  selected,
  onClick,
  children,
}: {
  readonly selected: boolean
  readonly onClick: () => void
  readonly children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`min-h-11 shrink-0 rounded-full border px-3.5 text-sm whitespace-nowrap transition-colors duration-150 ${
        selected ? 'border-accent bg-accent/20 font-semibold text-ink' : 'border-line-strong bg-surface text-muted'
      }`}
    >
      {children}
    </button>
  )
}
