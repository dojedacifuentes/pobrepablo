import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  addMonthsAnchored,
  dateParts,
  dayInMonth,
  dayOfMonthOnOrAfter,
  daysBetween,
  daysInMonth,
  fixedClock,
  fromEpochDay,
  isLeapYear,
  isWithin,
  lastDayOf,
  localDate,
  monthPeriod,
  nextDayOfMonthAfter,
  toEpochDay,
  yearMonth,
  yearMonthOf,
} from './dates'
import { DomainError } from './errors'
import { arbDate } from './testing/arbitraries'
import { d } from './testing/builders'

describe('fechas de calendario', () => {
  it('acepta solo fechas que existen, escritas YYYY-MM-DD', () => {
    expect(localDate('2026-11-09')).toBe('2026-11-09')
    for (const invalid of ['2026-02-30', '2026-13-01', '2026-00-10', '26-01-01', '2026-1-1', '2026-11-09T00:00', '']) {
      expect(() => localDate(invalid)).toThrow(DomainError)
    }
  })

  it('conoce los años bisiestos', () => {
    expect(isLeapYear(2024)).toBe(true)
    expect(isLeapYear(2026)).toBe(false)
    expect(isLeapYear(2000)).toBe(true)
    expect(isLeapYear(1900)).toBe(false)
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(localDate('2024-02-29')).toBe('2024-02-29')
    expect(() => localDate('2026-02-29')).toThrow(DomainError)
  })

  it('cuenta días sin depender de ningún reloj ni zona horaria', () => {
    expect(toEpochDay(d('1970-01-01'))).toBe(0)
    expect(toEpochDay(d('2000-03-01'))).toBe(11017)
    expect(toEpochDay(d('2026-11-09'))).toBe(20766)
    expect(fromEpochDay(20766)).toBe('2026-11-09')
  })

  it('suma días cruzando meses, años y el 29 de febrero', () => {
    expect(addDays(d('2026-12-31'), 1)).toBe('2027-01-01')
    expect(addDays(d('2024-02-28'), 1)).toBe('2024-02-29')
    expect(addDays(d('2026-02-28'), 1)).toBe('2026-03-01')
    expect(addDays(d('2026-03-01'), -1)).toBe('2026-02-28')
    expect(daysBetween(d('2026-11-09'), d('2026-11-30'))).toBe(21)
    expect(daysBetween(d('2026-11-30'), d('2026-11-09'))).toBe(-21)
  })

  it('ida y vuelta por el número de día devuelve la misma fecha', () => {
    fc.assert(
      fc.property(arbDate('1900-01-01', '2999-12-31'), (date) => {
        expect(fromEpochDay(toEpochDay(date))).toBe(date)
        const next = addDays(date === '2999-12-31' ? d('2999-12-30') : date, 1)
        expect(dateParts(next).day).toBeGreaterThanOrEqual(1)
      }),
    )
  })

  it('el día siguiente siempre es posterior y está a un día de distancia', () => {
    fc.assert(
      fc.property(arbDate('1900-01-01', '2999-12-30'), (date) => {
        const next = addDays(date, 1)
        expect(next > date).toBe(true)
        expect(daysBetween(date, next)).toBe(1)
      }),
    )
  })
})

describe('meses', () => {
  it('conserva el día ancla y lo acorta en los meses cortos', () => {
    expect(addMonthsAnchored(d('2026-01-31'), 1)).toBe('2026-02-28')
    expect(addMonthsAnchored(d('2026-01-31'), 2)).toBe('2026-03-31')
    expect(addMonthsAnchored(d('2026-01-31'), 3)).toBe('2026-04-30')
    expect(addMonthsAnchored(d('2024-01-31'), 1)).toBe('2024-02-29')
    expect(addMonthsAnchored(d('2026-11-30'), 3)).toBe('2027-02-28')
    expect(addMonthsAnchored(d('2026-03-15'), -4)).toBe('2025-11-15')
  })

  it('encuentra el próximo día de pago', () => {
    expect(nextDayOfMonthAfter(d('2026-11-03'), 5)).toBe('2026-11-05')
    expect(nextDayOfMonthAfter(d('2026-11-05'), 5)).toBe('2026-12-05')
    expect(nextDayOfMonthAfter(d('2026-11-09'), 5)).toBe('2026-12-05')
    expect(nextDayOfMonthAfter(d('2026-12-20'), 5)).toBe('2027-01-05')
    expect(nextDayOfMonthAfter(d('2026-01-31'), 31)).toBe('2026-02-28')
    expect(nextDayOfMonthAfter(d('2026-02-28'), 31)).toBe('2026-03-31')
  })

  it('puede mantener un día distinto al de la fecha de partida', () => {
    // A card paid on the 31st whose first bill fell on 28 February keeps falling on month ends.
    expect(addMonthsAnchored(d('2026-02-28'), 1, 31)).toBe('2026-03-31')
    expect(addMonthsAnchored(d('2026-02-28'), 2, 31)).toBe('2026-04-30')
    expect(addMonthsAnchored(d('2026-02-28'), 1)).toBe('2026-03-28')
    expect(() => addMonthsAnchored(d('2026-02-28'), 1, 32)).toThrow(DomainError)
  })

  it('encuentra el día del mes en la misma fecha o después', () => {
    expect(dayOfMonthOnOrAfter(d('2026-11-04'), 20)).toBe('2026-11-20')
    expect(dayOfMonthOnOrAfter(d('2026-11-20'), 20)).toBe('2026-11-20')
    expect(dayOfMonthOnOrAfter(d('2026-11-21'), 20)).toBe('2026-12-20')
    expect(dayOfMonthOnOrAfter(d('2026-02-10'), 31)).toBe('2026-02-28')
    expect(dayInMonth(yearMonth('2026-02'), 30)).toBe('2026-02-28')
  })

  it('opera con meses de calendario', () => {
    expect(yearMonthOf(d('2026-11-09'))).toBe('2026-11')
    expect(addMonths(yearMonth('2026-11'), 2)).toBe('2027-01')
    expect(addMonths(yearMonth('2026-01'), -1)).toBe('2025-12')
    expect(lastDayOf(yearMonth('2026-02'))).toBe('2026-02-28')
    expect(monthPeriod(yearMonth('2026-11'))).toEqual({ start: '2026-11-01', end: '2026-11-30' })
    expect(() => yearMonth('2026-13')).toThrow(DomainError)
  })

  it('un período incluye sus dos extremos', () => {
    const november = monthPeriod(yearMonth('2026-11'))
    expect(isWithin(d('2026-11-01'), november)).toBe(true)
    expect(isWithin(d('2026-11-30'), november)).toBe(true)
    expect(isWithin(d('2026-10-31'), november)).toBe(false)
    expect(isWithin(d('2026-12-01'), november)).toBe(false)
  })

  it('el reloj fijo siempre responde el mismo día', () => {
    expect(fixedClock(d('2026-11-09')).today()).toBe('2026-11-09')
  })
})
