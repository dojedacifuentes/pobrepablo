import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { accountBalance, balancesFromHistory } from './balances'
import {
  cardDueDate,
  cardObligationHorizon,
  cardStatement,
  defaultInstallmentPlan,
  installmentSchedule,
  outstandingDueBy,
} from './credit-card'
import { addDays } from './dates'
import { DomainError } from './errors'
import { atLeastZero, negate, sum } from './money'
import { arbAmount, arbDate, arbLedger } from './testing/arbitraries'
import { CARD, CHECKING, account, cat, clp, d, expense, income, transfer } from './testing/builders'

const card = account(CARD, 'credit_card', 0, { paymentDay: 5 })
const cardWithStatement = account(CARD, 'credit_card', 0, { paymentDay: 5, statementDay: 20 })

describe('cuándo se paga un cargo de la tarjeta', () => {
  it('sin día de facturación, entra en la próxima cuenta', () => {
    expect(cardDueDate(card, d('2026-11-04'))).toBe('2026-11-05')
    expect(cardDueDate(card, d('2026-11-05'))).toBe('2026-12-05')
    expect(cardDueDate(card, d('2026-11-09'))).toBe('2026-12-05')
  })

  it('con día de facturación, lo comprado después del cierre pasa a la cuenta siguiente', () => {
    expect(cardDueDate(cardWithStatement, d('2026-11-04'))).toBe('2026-12-05')
    expect(cardDueDate(cardWithStatement, d('2026-11-20'))).toBe('2026-12-05')
    expect(cardDueDate(cardWithStatement, d('2026-11-21'))).toBe('2027-01-05')
  })

  it('una tarjeta sin día de pago debe el cargo el mismo día', () => {
    expect(cardDueDate(account(CARD, 'credit_card'), d('2026-11-09'))).toBe('2026-11-09')
  })

  it('el horizonte de obligaciones siempre alcanza la cuenta que incluiría una compra de hoy', () => {
    expect(cardObligationHorizon(card, d('2026-11-10'), d('2026-11-30'))).toBe('2026-12-05')
    expect(cardObligationHorizon(card, d('2026-11-03'), d('2026-11-30'))).toBe('2026-11-30')
    expect(cardObligationHorizon(cardWithStatement, d('2026-11-25'), d('2026-11-30'))).toBe('2027-01-05')
  })
})

describe('tarjeta de crédito', () => {
  const plan = defaultInstallmentPlan(card, d('2026-11-09'), 3)
  const purchase = expense('e1', '2026-11-09', 100_000, CARD, { installments: plan })

  it('la primera cuota vence en la cuenta que incluye la compra', () => {
    expect(plan).toEqual({ count: 3, firstDueDate: '2026-12-05', dueDay: 5 })
    expect(defaultInstallmentPlan(account(CARD, 'credit_card'), d('2026-11-09'))).toEqual({
      count: 1,
      firstDueDate: '2026-11-09',
    })
  })

  it('las cuotas suman la compra y son obligaciones futuras', () => {
    const statement = cardStatement(card, [purchase], d('2026-11-10'))
    expect(statement.debt).toBe(100_000)
    expect(statement.installments.map((item) => [item.number, item.dueDate, item.amount])).toEqual([
      [1, '2026-12-05', 33_334],
      [2, '2027-01-05', 33_333],
      [3, '2027-02-05', 33_333],
    ])
    expect(outstandingDueBy(statement, d('2026-11-30'))).toBe(0)
    expect(outstandingDueBy(statement, d('2026-12-31'))).toBe(33_334)
    expect(outstandingDueBy(statement, d('2027-02-05'))).toBe(100_000)
  })

  it('una tarjeta que se paga el 31 sigue venciendo a fin de mes después de febrero', () => {
    const monthEnd = account(CARD, 'credit_card', 0, { paymentDay: 31 })
    const schedule = installmentSchedule('x', clp(400_000), defaultInstallmentPlan(monthEnd, d('2026-02-10'), 4))
    expect(schedule.map((item) => item.dueDate)).toEqual(['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'])
  })

  it('pagar la tarjeta baja la deuda, empezando por la cuota más antigua', () => {
    const statement = cardStatement(
      card,
      [purchase, transfer('t1', '2026-11-10', 50_000, CHECKING, CARD)],
      d('2026-11-10'),
    )
    expect(statement.debt).toBe(50_000)
    expect(statement.installments.map((item) => item.outstanding)).toEqual([0, 16_667, 33_333])
    expect(outstandingDueBy(statement, d('2026-12-31'))).toBe(0)
    expect(outstandingDueBy(statement, d('2027-01-31'))).toBe(16_667)
  })

  it('una compra anulada o con fecha posterior no genera deuda', () => {
    expect(cardStatement(card, [{ ...purchase, voided: true }], d('2026-11-10')).debt).toBe(0)
    expect(cardStatement(card, [purchase], d('2026-11-08')).debt).toBe(0)
  })

  it('una compra sin plan va entera a la cuenta que la incluye', () => {
    const statement = cardStatement(card, [expense('e1', '2026-11-09', 45_000, CARD)], d('2026-11-10'))
    expect(statement.installments).toMatchObject([{ number: 1, count: 1, dueDate: '2026-12-05', amount: 45_000 }])
  })

  it('intereses y comisiones aumentan la deuda y se pagan con la cuenta siguiente', () => {
    const interest = expense('e2', '2026-11-25', 4_300, CARD, { categoryId: cat('deudas') })
    const statement = cardStatement(card, [purchase, interest], d('2026-11-30'))
    expect(statement.debt).toBe(104_300)
    expect(outstandingDueBy(statement, d('2026-11-30'))).toBe(0)
    expect(outstandingDueBy(statement, d('2026-12-05'))).toBe(37_634)
  })

  it('la deuda con que parte la tarjeta vence en su primer día de pago', () => {
    const indebted = account(CARD, 'credit_card', -200_000, { paymentDay: 5 })
    const statement = cardStatement(indebted, [], d('2026-11-10'))
    expect(statement.debt).toBe(200_000)
    expect(statement.installments).toMatchObject([{ sourceId: 'opening', dueDate: '2026-01-05', amount: 200_000 }])
    expect(outstandingDueBy(statement, d('2026-11-10'))).toBe(200_000)
  })

  it('una devolución o un pago en exceso queda como saldo a favor', () => {
    const statement = cardStatement(
      card,
      [purchase, transfer('t1', '2026-11-10', 90_000, CHECKING, CARD), income('i1', '2026-11-11', 30_000, CARD)],
      d('2026-11-12'),
    )
    expect(statement.debt).toBe(0)
    expect(statement.unappliedCredit).toBe(20_000)
  })

  it('solo una tarjeta tiene estado de cuenta', () => {
    expect(() => cardStatement(account(CHECKING, 'checking'), [], d('2026-11-10'))).toThrow(DomainError)
    expect(() => cardDueDate(account(CHECKING, 'checking'), d('2026-11-10'))).toThrow(DomainError)
    expect(() => installmentSchedule('x', clp(0), plan)).toThrow(DomainError)
  })
})

describe('invariantes de la tarjeta', () => {
  it('las cuotas de una compra suman exactamente la compra y vencen en orden', () => {
    fc.assert(
      fc.property(
        arbAmount(50_000_000),
        fc.integer({ min: 1, max: 60 }),
        fc.integer({ min: 1, max: 31 }),
        (total, count, paymentDay) => {
          const anyCard = account(CARD, 'credit_card', 0, { paymentDay })
          const schedule = installmentSchedule('x', total, defaultInstallmentPlan(anyCard, d('2026-01-31'), count))
          expect(schedule).toHaveLength(count)
          expect(sum(schedule.map((item) => item.amount))).toBe(total)
          const dates = schedule.map((item) => item.dueDate)
          expect(dates).toEqual(dates.toSorted())
          expect(new Set(dates.map((date) => date.slice(0, 7))).size).toBe(count)
        },
      ),
    )
  })

  it('un cargo nunca vence antes de hacerse, y un cargo posterior nunca vence antes que uno anterior', () => {
    fc.assert(
      fc.property(arbLedger, arbDate(), fc.integer({ min: 0, max: 60 }), (ledger, chargeDate, gap) => {
        const anyCard = ledger.accounts.find((item) => item.id === CARD)
        if (anyCard === undefined) {
          return
        }
        const first = cardDueDate(anyCard, chargeDate)
        const second = cardDueDate(anyCard, addDays(chargeDate, gap))
        expect(first >= chargeDate).toBe(true)
        expect(second >= first).toBe(true)
      }),
    )
  })

  it('la deuda es siempre el saldo negativo de la tarjeta, y nunca menos que cero', () => {
    fc.assert(
      fc.property(arbLedger, ({ accounts, transactions }) => {
        const cardAccount = accounts.find((item) => item.id === CARD)
        if (cardAccount === undefined) {
          return
        }
        const balance = accountBalance(balancesFromHistory(accounts, transactions), CARD)
        const statement = cardStatement(cardAccount, transactions, d('2999-12-31'))
        expect(statement.debt).toBe(atLeastZero(negate(balance)))
        expect(statement.unappliedCredit).toBe(atLeastZero(balance))
        expect(sum(statement.installments.map((item) => item.outstanding))).toBe(statement.debt)
      }),
    )
  })
})
