import { describe, expect, it } from 'vitest'
import { indexAccounts } from './accounts'
import { DomainError } from './errors'
import { canRelease, fulfilReservation, goalProgress, reservedForGoal, suggestedMonthlyContribution } from './goals'
import { toId } from './ids'
import { CASH, CHECKING, SAVINGS, baseAccounts, clp, d, goal, reservation, transfer } from './testing/builders'

const accounts = indexAccounts(baseAccounts({ checking: 1_000_000 }))
const trip = goal('viaje', 1_200_000, { targetDate: d('2027-03-31') })
const today = d('2026-11-10')

describe('metas de ahorro', () => {
  it('una reserva aparta dinero sin moverlo de la cuenta', () => {
    const progress = goalProgress(trip, [reservation('r1', 'viaje', '2026-11-02', 50_000)], [], accounts, today)
    expect(progress).toMatchObject({
      reserved: 50_000,
      transferred: 0,
      accumulated: 50_000,
      remaining: 1_150_000,
      percent: 4,
      reached: false,
    })
  })

  it('una transferencia efectiva a la cuenta de ahorro también suma, y un retiro resta', () => {
    const progress = goalProgress(
      trip,
      [reservation('r1', 'viaje', '2026-11-02', 50_000)],
      [
        transfer('t1', '2026-11-05', 150_000, CHECKING, SAVINGS, { goalId: toId('viaje') }),
        transfer('t2', '2026-11-08', 20_000, SAVINGS, CHECKING, { goalId: toId('viaje') }),
        transfer('t3', '2026-11-09', 70_000, CHECKING, SAVINGS),
      ],
      accounts,
      today,
    )
    expect(progress).toMatchObject({ reserved: 50_000, transferred: 130_000, accumulated: 180_000, percent: 15 })
  })

  it('liberar una reserva la reduce, y nunca queda negativa', () => {
    const reservations = [
      reservation('r1', 'viaje', '2026-11-02', 50_000),
      reservation('r2', 'viaje', '2026-11-06', -20_000),
      { ...reservation('r3', 'viaje', '2026-11-07', 99_000), voided: true },
      reservation('r4', 'viaje', '2026-11-20', 10_000),
    ]
    expect(reservedForGoal(trip.id, reservations, today)).toBe(30_000)
    expect(canRelease(trip.id, clp(30_000), reservations, today)).toBe(true)
    expect(canRelease(trip.id, clp(30_001), reservations, today)).toBe(false)
    expect(reservedForGoal(trip.id, [reservation('r1', 'viaje', '2026-11-02', -5_000)], today)).toBe(0)
  })

  it('liberar de más vacía la reserva, y lo reservado después no paga ese exceso', () => {
    const reservations = [
      reservation('r1', 'viaje', '2026-11-02', 50_000),
      reservation('r2', 'viaje', '2026-11-05', -80_000),
      reservation('r3', 'viaje', '2026-11-08', 40_000),
    ]
    expect(reservedForGoal(trip.id, reservations, d('2026-11-06'))).toBe(0)
    expect(reservedForGoal(trip.id, reservations, today)).toBe(40_000)
    expect(reservedForGoal(trip.id, reservations.toReversed(), today)).toBe(40_000)
  })

  it('convertir una reserva en transferencia efectiva no cuenta el ahorro dos veces', () => {
    const reservations = [reservation('r1', 'viaje', '2026-11-02', 150_000)]
    const { release, transfer: moved } = fulfilReservation({
      goalId: trip.id,
      amount: clp(150_000),
      date: today,
      reservationId: toId('r2'),
      transactionId: toId('t1'),
      fromAccountId: CHECKING,
      toAccountId: SAVINGS,
      reservations,
      accounts,
      today,
    })
    expect(release).toMatchObject({ goalId: 'viaje', amount: -150_000, date: '2026-11-10' })
    expect(moved).toMatchObject({ kind: 'transfer', goalId: 'viaje', amount: 150_000, toAccountId: SAVINGS })

    const progress = goalProgress(trip, [...reservations, release], [moved], accounts, today)
    expect(progress).toMatchObject({ reserved: 0, transferred: 150_000, accumulated: 150_000 })

    const invalid = {
      goalId: trip.id,
      date: today,
      reservationId: toId<'reservation'>('r2'),
      transactionId: toId<'transaction'>('t1'),
      reservations,
      accounts,
      today,
    }
    expect(() => fulfilReservation({ ...invalid, amount: clp(150_001), fromAccountId: CHECKING, toAccountId: SAVINGS })).toThrow(
      DomainError,
    )
    expect(() => fulfilReservation({ ...invalid, amount: clp(1000), fromAccountId: CHECKING, toAccountId: CASH })).toThrow(
      DomainError,
    )
  })

  it('reconoce la meta alcanzada', () => {
    const progress = goalProgress(
      goal('fondo', 100_000),
      [reservation('r1', 'fondo', '2026-11-02', 120_000)],
      [],
      accounts,
      today,
    )
    expect(progress).toMatchObject({ reached: true, percent: 100, remaining: 0 })
  })

  it('sugiere el aporte mensual redondeado hacia arriba', () => {
    expect(suggestedMonthlyContribution(trip, clp(200_000), today)).toBe(250_000)
    expect(suggestedMonthlyContribution(trip, clp(199_999), today)).toBe(250_001)
    expect(suggestedMonthlyContribution(trip, clp(1_200_000), today)).toBe(0)
    expect(suggestedMonthlyContribution(goal('sin-fecha', 500_000), clp(0), today)).toBeNull()
    expect(suggestedMonthlyContribution(goal('vencida', 500_000, { targetDate: d('2026-11-01') }), clp(100_000), today)).toBe(
      400_000,
    )
    expect(suggestedMonthlyContribution(goal('este-mes', 500_000, { targetDate: d('2026-11-30') }), clp(0), today)).toBe(
      500_000,
    )
  })

  it('rechaza metas sin objetivo', () => {
    expect(() => goalProgress(goal('x', 0), [], [], accounts, today)).toThrow(DomainError)
  })
})
