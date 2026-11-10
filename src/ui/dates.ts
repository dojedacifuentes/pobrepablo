import { type LocalDate, type YearMonth, dateParts, daysBetween, yearMonthParts } from '@/domain'

/**
 * How dates are written for a person, in Chilean Spanish. Only words: which day is «today» and
 * every calculation with dates belongs to the domain.
 */

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const

const SHORT_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'] as const

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** «Noviembre 2026». */
export function monthTitle(month: YearMonth): string {
  const { year, month: number } = yearMonthParts(month)
  return `${capitalized(MONTHS[number - 1] ?? '')} ${String(year)}`
}

/** «9 nov». */
export function shortDate(date: LocalDate): string {
  const { month, day } = dateParts(date)
  return `${String(day)} ${SHORT_MONTHS[month - 1] ?? ''}`
}

/** «Hoy», «Ayer» or «9 de noviembre»; with the year when it is not the current one. */
export function dayTitle(date: LocalDate, today: LocalDate): string {
  const distance = daysBetween(date, today)
  if (distance === 0) {
    return 'Hoy'
  }
  if (distance === 1) {
    return 'Ayer'
  }
  const { year, month, day } = dateParts(date)
  const sameYear = year === dateParts(today).year
  return `${String(day)} de ${MONTHS[month - 1] ?? ''}${sameYear ? '' : ` de ${String(year)}`}`
}

/** «hoy», «mañana», «en 5 días», «hace 3 días»: how far a due date is. */
export function dueLabel(dueDate: LocalDate, today: LocalDate): string {
  const days = daysBetween(today, dueDate)
  if (days === 0) {
    return 'hoy'
  }
  if (days === 1) {
    return 'mañana'
  }
  if (days === -1) {
    return 'ayer'
  }
  return days > 0 ? `en ${String(days)} días` : `hace ${String(-days)} días`
}
