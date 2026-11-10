import { invariant } from './errors'

declare const localDateBrand: unique symbol
declare const yearMonthBrand: unique symbol

/** A calendar day in America/Santiago, written `YYYY-MM-DD`. Never a UTC instant. */
export type LocalDate = string & { readonly [localDateBrand]: true }

/** A calendar month, written `YYYY-MM`. */
export type YearMonth = string & { readonly [yearMonthBrand]: true }

/** The domain never reads the system clock: whoever calls it provides one. */
export interface Clock {
  today(): LocalDate
}

/** Both ends are included. */
export interface Period {
  readonly start: LocalDate
  readonly end: LocalDate
}

const MIN_YEAR = 1900
const MAX_YEAR = 2999

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31
}

function assertYearAndMonth(year: number, month: number): void {
  invariant(Number.isInteger(year) && year >= MIN_YEAR && year <= MAX_YEAR, `Año fuera de rango: ${String(year)}`)
  invariant(Number.isInteger(month) && month >= 1 && month <= 12, `Mes inválido: ${String(month)}`)
}

export function makeDate(year: number, month: number, day: number): LocalDate {
  assertYearAndMonth(year, month)
  invariant(
    Number.isInteger(day) && day >= 1 && day <= daysInMonth(year, month),
    `Día inválido: ${String(year)}-${String(month)}-${String(day)}`,
  )
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}` as LocalDate
}

export function localDate(text: string): LocalDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  invariant(match !== null, `Fecha inválida: ${text}`)
  return makeDate(Number(match[1]), Number(match[2]), Number(match[3]))
}

export function dateParts(date: LocalDate): { year: number; month: number; day: number } {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  }
}

export function dayOfMonth(date: LocalDate): number {
  return dateParts(date).day
}

/** Days since 1970-01-01 in the proleptic Gregorian calendar (pure integer arithmetic). */
export function toEpochDay(date: LocalDate): number {
  const { year, month, day } = dateParts(date)
  const y = month <= 2 ? year - 1 : year
  const era = Math.floor(y / 400)
  const yearOfEra = y - era * 400
  const dayOfYear = Math.floor((153 * (month > 2 ? month - 3 : month + 9) + 2) / 5) + day - 1
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear
  return era * 146097 + dayOfEra - 719468
}

export function fromEpochDay(epochDay: number): LocalDate {
  invariant(Number.isInteger(epochDay), 'El número de día debe ser entero')
  const z = epochDay + 719468
  const era = Math.floor(z / 146097)
  const dayOfEra = z - era * 146097
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
  )
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100))
  const monthIndex = Math.floor((5 * dayOfYear + 2) / 153)
  const day = dayOfYear - Math.floor((153 * monthIndex + 2) / 5) + 1
  const month = monthIndex < 10 ? monthIndex + 3 : monthIndex - 9
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0)
  return makeDate(year, month, day)
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromEpochDay(toEpochDay(date) + days)
}

/** How many days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return toEpochDay(to) - toEpochDay(from)
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function minDate(a: LocalDate, b: LocalDate): LocalDate {
  return a <= b ? a : b
}

export function maxDate(a: LocalDate, b: LocalDate): LocalDate {
  return a >= b ? a : b
}

/**
 * Moves `anchor` by whole months keeping its day of the month, shortened when the target month is
 * shorter. It is always computed from the anchor, so the 31st becomes 28 February and 31 March
 * again, never 28 March.
 */
export function addMonthsAnchored(anchor: LocalDate, months: number, anchorDay?: number): LocalDate {
  invariant(Number.isInteger(months), 'La cantidad de meses debe ser entera')
  const { year, month, day } = dateParts(anchor)
  const wantedDay = anchorDay ?? day
  assertDayOfMonth(wantedDay)
  const index = year * 12 + (month - 1) + months
  const targetYear = Math.floor(index / 12)
  const targetMonth = index - targetYear * 12 + 1
  assertYearAndMonth(targetYear, targetMonth)
  return makeDate(targetYear, targetMonth, Math.min(wantedDay, daysInMonth(targetYear, targetMonth)))
}

function assertDayOfMonth(day: number): void {
  invariant(Number.isInteger(day) && day >= 1 && day <= 31, `Día del mes inválido: ${String(day)}`)
}

/** `day` of the given month, shortened when the month is shorter. */
export function dayInMonth(value: YearMonth, day: number): LocalDate {
  assertDayOfMonth(day)
  const { year, month } = yearMonthParts(value)
  return makeDate(year, month, Math.min(day, daysInMonth(year, month)))
}

/** The first date strictly after `date` that falls on `day` of a month (shortened in short months). */
export function nextDayOfMonthAfter(date: LocalDate, day: number): LocalDate {
  const month = yearMonthOf(date)
  const thisMonth = dayInMonth(month, day)
  return thisMonth > date ? thisMonth : dayInMonth(addMonths(month, 1), day)
}

/** The first date on or after `date` that falls on `day` of a month (shortened in short months). */
export function dayOfMonthOnOrAfter(date: LocalDate, day: number): LocalDate {
  const month = yearMonthOf(date)
  const thisMonth = dayInMonth(month, day)
  return thisMonth >= date ? thisMonth : dayInMonth(addMonths(month, 1), day)
}

export function makeYearMonth(year: number, month: number): YearMonth {
  assertYearAndMonth(year, month)
  return `${pad(year, 4)}-${pad(month, 2)}` as YearMonth
}

export function yearMonth(text: string): YearMonth {
  const match = /^(\d{4})-(\d{2})$/.exec(text)
  invariant(match !== null, `Mes inválido: ${text}`)
  return makeYearMonth(Number(match[1]), Number(match[2]))
}

export function yearMonthParts(value: YearMonth): { year: number; month: number } {
  return { year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)) }
}

export function yearMonthOf(date: LocalDate): YearMonth {
  return date.slice(0, 7) as YearMonth
}

export function addMonths(value: YearMonth, months: number): YearMonth {
  invariant(Number.isInteger(months), 'La cantidad de meses debe ser entera')
  const { year, month } = yearMonthParts(value)
  const index = year * 12 + (month - 1) + months
  const targetYear = Math.floor(index / 12)
  return makeYearMonth(targetYear, index - targetYear * 12 + 1)
}

export function firstDayOf(value: YearMonth): LocalDate {
  const { year, month } = yearMonthParts(value)
  return makeDate(year, month, 1)
}

export function lastDayOf(value: YearMonth): LocalDate {
  const { year, month } = yearMonthParts(value)
  return makeDate(year, month, daysInMonth(year, month))
}

export function daysInYearMonth(value: YearMonth): number {
  const { year, month } = yearMonthParts(value)
  return daysInMonth(year, month)
}

export function monthPeriod(value: YearMonth): Period {
  return { start: firstDayOf(value), end: lastDayOf(value) }
}

export function isWithin(date: LocalDate, period: Period): boolean {
  return date >= period.start && date <= period.end
}

/** A clock that always answers the same day. For tests and for replaying history. */
export function fixedClock(date: LocalDate): Clock {
  return { today: () => date }
}
