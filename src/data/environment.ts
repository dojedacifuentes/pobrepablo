import { type LocalDate, localDate } from '@/domain'

/** A moment in UTC, ISO 8601 (`2026-11-10T14:03:22.120Z`). Only for traces: never for accounting. */
export type Instant = string

/**
 * What the data layer takes from the outside world. Injected, so that tests are deterministic and
 * the domain never reads the system clock by itself.
 */
export interface Environment {
  /** Today's calendar day in America/Santiago. */
  today(): LocalDate
  now(): Instant
  /** A new UUID. */
  newId(): string
}

const SANTIAGO = 'America/Santiago'

function santiagoDay(instant: Date): LocalDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SANTIAGO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? ''
  return localDate(`${part('year')}-${part('month')}-${part('day')}`)
}

/** The real clock and the real random generator. The only place where they are read. */
export function systemEnvironment(): Environment {
  return {
    today: () => santiagoDay(new Date()),
    now: () => new Date().toISOString(),
    newId: () => crypto.randomUUID(),
  }
}

/** The calendar day in Chile of a given instant. Exposed for tests of the time-zone edge. */
export function santiagoDayOf(instant: Instant): LocalDate {
  return santiagoDay(new Date(instant))
}
