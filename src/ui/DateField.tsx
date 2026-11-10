import { CalendarDays } from 'lucide-react'
import { type LocalDate, daysBetween, localDate } from '@/domain'
import { shortDate } from './dates'

interface DateFieldProps {
  readonly label: string
  readonly value: LocalDate
  readonly today: LocalDate
  /** Called with `null` when the field is emptied: the caller decides what that means. */
  readonly onChange: (value: LocalDate | null) => void
}

function words(value: LocalDate, today: LocalDate): string {
  const ago = daysBetween(value, today)
  return ago === 0 ? 'Hoy' : ago === 1 ? 'Ayer' : shortDate(value)
}

/**
 * A date, never later than today. It reads «Hoy», «Ayer» or «9 nov»: a browser writes dates in
 * the format of the device, and «11/10» must not be left to mean two different days. Tapping it
 * opens the date picker of the phone.
 */
export function DateField({ label, value, today, onChange }: DateFieldProps) {
  return (
    <span className="relative inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-line-strong bg-surface px-3 text-sm text-ink focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
      <CalendarDays size={16} aria-hidden="true" className="shrink-0 text-muted" />
      <span className="whitespace-nowrap">{words(value, today)}</span>
      <input
        type="date"
        aria-label={label}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
        value={value}
        max={today}
        onClick={(event) => {
          // On a desktop browser a click only focuses the field: ask for the picker explicitly.
          try {
            event.currentTarget.showPicker()
          } catch {
            // The browser will open it its own way.
          }
        }}
        onChange={(event) => {
          const next = event.target.value
          onChange(next.length === 0 || next > today ? null : localDate(next))
        }}
      />
    </span>
  )
}
