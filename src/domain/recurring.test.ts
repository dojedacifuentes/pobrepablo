import { describe, expect, it } from 'vitest'
import { indexAccounts } from './accounts'
import { DomainError } from './errors'
import { toId } from './ids'
import {
  type ListOccurrencesInput,
  confirmOccurrence,
  duplicateConfirmations,
  listOccurrences,
  occurrenceDates,
  rescheduleRule,
  validateRule,
} from './recurring'
import { CARD, CHECKING, SAVINGS, account, baseAccounts, cat, clp, d, expense, rule } from './testing/builders'
import { type Transaction, voidTransaction } from './transactions'

describe('fechas de un recurrente', () => {
  it('mensual: una fecha por mes', () => {
    expect(occurrenceDates(rule('arriendo', '2026-11-01', 420_000), d('2026-11-01'), d('2027-02-28'))).toEqual([
      '2026-11-01',
      '2026-12-01',
      '2027-01-01',
      '2027-02-01',
    ])
  })

  it('mensual el día 31: se acorta en los meses cortos y vuelve al 31', () => {
    expect(occurrenceDates(rule('r', '2026-01-31', 1000), d('2026-01-01'), d('2026-04-30'))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ])
  })

  it('quincenal: semanal con intervalo 2', () => {
    const fortnightly = rule('r', '2026-11-02', 1000, { frequency: 'weekly', interval: 2 })
    expect(occurrenceDates(fortnightly, d('2026-11-01'), d('2026-11-30'))).toEqual([
      '2026-11-02',
      '2026-11-16',
      '2026-11-30',
    ])
  })

  it('anual desde un 29 de febrero', () => {
    const yearly = rule('r', '2024-02-29', 1000, { frequency: 'yearly' })
    expect(occurrenceDates(yearly, d('2024-01-01'), d('2028-12-31'))).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
    ])
  })

  it('respeta la fecha de término y el inicio de la ventana', () => {
    const ending = rule('r', '2026-09-10', 1000, { endDate: d('2026-12-09') })
    expect(occurrenceDates(ending, d('2026-10-01'), d('2027-06-30'))).toEqual(['2026-10-10', '2026-11-10'])
    expect(occurrenceDates(rule('r', '2027-01-01', 1000), d('2026-01-01'), d('2026-12-31'))).toEqual([])
  })

  it('rechaza reglas mal formadas', () => {
    const invalid = [
      rule('r', '2026-11-01', 0),
      rule('r', '2026-11-01', 1000, { interval: 0 }),
      rule('r', '2026-11-01', 1000, { kind: 'transfer', toAccountId: CHECKING }),
      rule('r', '2026-11-01', 1000, { endDate: d('2026-10-01') }),
    ]
    for (const candidate of invalid) {
      expect(() => {
        validateRule(candidate)
      }).toThrow(DomainError)
    }
  })
})

const accounts = indexAccounts(baseAccounts())
const today = d('2026-11-10')
const through = d('2026-12-31')

function list(overrides: Partial<ListOccurrencesInput>) {
  return listOccurrences({ rules: [], transactions: [], cancelled: [], accounts, today, through, ...overrides })
}

function find(occurrences: ReturnType<typeof listOccurrences>, ruleId: string, dueDate: string) {
  const found = occurrences.find((item) => item.ruleId === ruleId && item.dueDate === dueDate)
  if (found === undefined) {
    throw new Error(`falta la ocurrencia ${ruleId} ${dueDate}`)
  }
  return found
}

describe('estados de un movimiento programado', () => {
  const rent = rule('arriendo', '2026-10-05', 420_000)
  const power = rule('luz', '2026-10-20', 30_000, { amountIsEstimate: true, categoryId: cat('luz') })

  it('vencido, pendiente y estimado según la fecha y el tipo de monto', () => {
    const occurrences = list({ rules: [rent, power] })
    expect(find(occurrences, 'arriendo', '2026-10-05').status).toBe('overdue')
    expect(find(occurrences, 'arriendo', '2026-11-05').status).toBe('overdue')
    expect(find(occurrences, 'arriendo', '2026-12-05').status).toBe('pending')
    expect(find(occurrences, 'luz', '2026-10-20').status).toBe('overdue')
    expect(find(occurrences, 'luz', '2026-11-20').status).toBe('estimated')
    expect(occurrences.map((item) => item.dueDate)).toEqual(occurrences.map((item) => item.dueDate).toSorted())
  })

  it('no programa nada anterior al saldo inicial de la cuenta, que ya lo incluye', () => {
    const recent = indexAccounts([account(CHECKING, 'checking', 1_000_000, { openingDate: d('2026-11-01') })])
    const old = rule('arriendo', '2026-06-05', 400_000)
    expect(list({ rules: [old], accounts: recent }).map((item) => item.dueDate)).toEqual(['2026-11-05', '2026-12-05'])
  })

  it('cancelado y pausado dejan de estar pendientes', () => {
    const cancelled = list({ rules: [rent], cancelled: [{ ruleId: rent.id, dueDate: d('2026-10-05') }] })
    expect(find(cancelled, 'arriendo', '2026-10-05').status).toBe('cancelled')
    expect(list({ rules: [{ ...rent, paused: true }] })).toEqual([])
  })

  it('un gasto compartido que pagó otra persona cubre la ocurrencia', () => {
    const covered = list({
      rules: [rent],
      coveredByShared: [{ ref: { ruleId: rent.id, dueDate: d('2026-11-05') }, sharedExpenseId: toId('s1') }],
    })
    expect(find(covered, 'arriendo', '2026-11-05')).toMatchObject({ status: 'confirmed', sharedExpenseId: 's1' })
    expect(find(covered, 'arriendo', '2026-11-05').transactionId).toBeUndefined()
    expect(find(covered, 'arriendo', '2026-10-05').status).toBe('overdue')

    // Only an expense can be covered: an expected income does not vanish because of a shared expense.
    const salary = rule('sueldo', '2026-11-25', 1_000_000, { kind: 'income', categoryId: cat('sueldo') })
    const income = list({
      rules: [salary],
      coveredByShared: [{ ref: { ruleId: salary.id, dueDate: d('2026-11-25') }, sharedExpenseId: toId('s1') }],
    })
    expect(find(income, 'sueldo', '2026-11-25').status).toBe('pending')
  })
})

describe('confirmar un movimiento programado', () => {
  const power = rule('luz', '2026-10-20', 30_000, { amountIsEstimate: true, categoryId: cat('luz') })
  const context = (transactions: readonly Transaction[] = []) => ({ accounts, transactions, today })

  it('lo convierte en un movimiento real, con el monto real', () => {
    const october = find(list({ rules: [power] }), 'luz', '2026-10-20')
    const real = confirmOccurrence(october, { id: toId('tx-luz'), date: d('2026-10-22'), amount: clp(27_450) }, context())
    expect(real).toMatchObject({
      kind: 'expense',
      date: '2026-10-22',
      amount: 27_450,
      accountId: CHECKING,
      categoryId: 'luz',
      occurrence: { ruleId: 'luz', dueDate: '2026-10-20' },
    })

    const confirmed = find(list({ rules: [power], transactions: [real] }), 'luz', '2026-10-20')
    expect(confirmed).toMatchObject({ status: 'confirmed', amount: 27_450, transactionId: 'tx-luz', amountIsEstimate: false })

    const afterVoiding = list({ rules: [power], transactions: [voidTransaction(real)] })
    expect(find(afterVoiding, 'luz', '2026-10-20').status).toBe('overdue')
  })

  it('no se puede confirmar dos veces, aunque la pantalla siga mostrando la ocurrencia vieja', () => {
    const october = find(list({ rules: [power] }), 'luz', '2026-10-20')
    const first = confirmOccurrence(october, { id: toId('a'), date: d('2026-10-22') }, context())
    // `october` is stale: it was read before the first confirmation was stored.
    expect(() => confirmOccurrence(october, { id: toId('b'), date: d('2026-10-23') }, context([first]))).toThrow(
      DomainError,
    )
    expect(() =>
      confirmOccurrence(october, { id: toId('b'), date: d('2026-10-23') }, context([voidTransaction(first)])),
    ).not.toThrow()
  })

  it('no acepta una fecha futura: el dinero todavía no se ha movido', () => {
    const november = find(list({ rules: [power] }), 'luz', '2026-11-20')
    expect(() => confirmOccurrence(november, { id: toId('tx'), date: d('2026-11-20') }, context())).toThrow(DomainError)
    // Paying early is fine: the date is today.
    expect(confirmOccurrence(november, { id: toId('tx'), date: today }, context())).toMatchObject({ date: '2026-11-10' })
  })

  it('un movimiento fechado en el futuro no hace desaparecer la ocurrencia', () => {
    const future = expense('tx', '2026-11-20', 30_000, CHECKING, {
      categoryId: cat('luz'),
      occurrence: { ruleId: power.id, dueDate: d('2026-11-20') },
    })
    expect(find(list({ rules: [power], transactions: [future] }), 'luz', '2026-11-20').status).toBe('estimated')
    // The day arrives: now it counts.
    const later = list({ rules: [power], transactions: [future], today: d('2026-11-20') })
    expect(find(later, 'luz', '2026-11-20').status).toBe('confirmed')
  })

  it('un cargo a la tarjeta nace con su cuota en la cuenta que lo incluye', () => {
    const streaming = rule('streaming', '2026-11-02', 9_990, { accountId: CARD, categoryId: cat('suscripciones') })
    const charged = find(list({ rules: [streaming] }), 'streaming', '2026-11-02')
    expect(confirmOccurrence(charged, { id: toId('tx'), date: d('2026-11-02') }, context())).toMatchObject({
      kind: 'expense',
      accountId: CARD,
      installments: { count: 1, firstDueDate: '2026-11-05', dueDay: 5 },
    })
    expect(
      confirmOccurrence(charged, { id: toId('tx'), date: d('2026-11-06'), installments: 3 }, context()),
    ).toMatchObject({ installments: { count: 3, firstDueDate: '2026-12-05', dueDay: 5 } })
  })

  it('las cuotas solo existen para un gasto con tarjeta', () => {
    const rent = find(list({ rules: [rule('arriendo', '2026-11-05', 400_000)] }), 'arriendo', '2026-11-05')
    expect(() =>
      confirmOccurrence(rent, { id: toId('tx'), date: d('2026-11-05'), installments: 3 }, context()),
    ).toThrow(DomainError)
  })

  it('un gasto pagado por el hogar se confirma como pago de gasto compartido', () => {
    const rent = rule('arriendo', '2026-11-05', 400_000)
    const due = find(list({ rules: [rent] }), 'arriendo', '2026-11-05')
    const paid = confirmOccurrence(due, { id: toId('tx'), date: d('2026-11-05'), sharedExpenseId: toId('s1') }, context())
    expect(paid).toMatchObject({
      kind: 'shared_payment',
      amount: 400_000,
      sharedExpenseId: 's1',
      occurrence: { ruleId: 'arriendo', dueDate: '2026-11-05' },
    })
    expect(find(list({ rules: [rent], transactions: [paid] }), 'arriendo', '2026-11-05').status).toBe('confirmed')
  })

  it('una transferencia programada se confirma como transferencia', () => {
    const saving = rule('ahorro', '2026-11-05', 50_000, { kind: 'transfer', toAccountId: SAVINGS })
    const first = find(list({ rules: [saving] }), 'ahorro', '2026-11-05')
    expect(confirmOccurrence(first, { id: toId('tx'), date: d('2026-11-05') }, context())).toMatchObject({
      kind: 'transfer',
      fromAccountId: CHECKING,
      toAccountId: SAVINGS,
      amount: 50_000,
    })
    expect(() =>
      confirmOccurrence(first, { id: toId('tx'), date: d('2026-11-05'), sharedExpenseId: toId('s1') }, context()),
    ).toThrow(DomainError)
  })

  it('detecta una ocurrencia confirmada por dos movimientos', () => {
    const ref = { ruleId: power.id, dueDate: d('2026-10-20') }
    const first = expense('a', '2026-10-20', 30_000, CHECKING, { occurrence: ref })
    const second = expense('b', '2026-10-21', 30_000, CHECKING, { occurrence: ref })
    expect(duplicateConfirmations([first])).toEqual([])
    expect(duplicateConfirmations([first, second])).toEqual([ref])
    expect(duplicateConfirmations([first, voidTransaction(second)])).toEqual([])
  })
})

describe('cambiar el calendario de una regla', () => {
  const rent = rule('arriendo', '2026-08-05', 400_000)
  const paid = ['2026-08-05', '2026-09-05', '2026-10-05', '2026-11-05'].map((date, index) =>
    expense(`pago-${String(index)}`, date, 400_000, CHECKING, {
      categoryId: cat('arriendo'),
      occurrence: { ruleId: rent.id, dueDate: d(date) },
    }),
  )

  it('conserva lo ya confirmado: la regla vieja se cierra y nace una nueva', () => {
    const { closed, next } = rescheduleRule(rent, d('2026-11-05'), { id: toId('arriendo-2'), startDate: d('2026-12-10') })
    expect(closed).toMatchObject({ id: 'arriendo', endDate: '2026-11-05' })
    expect(next).toMatchObject({ id: 'arriendo-2', startDate: '2026-12-10', amount: 400_000 })

    const occurrences = list({ rules: [closed, next], transactions: paid })
    expect(occurrences.map((item) => [item.ruleId, item.dueDate, item.status])).toEqual([
      ['arriendo', '2026-08-05', 'confirmed'],
      ['arriendo', '2026-09-05', 'confirmed'],
      ['arriendo', '2026-10-05', 'confirmed'],
      ['arriendo', '2026-11-05', 'confirmed'],
      ['arriendo-2', '2026-12-10', 'pending'],
    ])
  })

  it('editar la fecha de inicio en el mismo lugar dejaría los pagos huérfanos: por eso no se hace', () => {
    const edited = { ...rent, startDate: d('2026-08-10') }
    const occurrences = list({ rules: [edited], transactions: paid })
    // Four payments are stored, yet not one occurrence recognises them.
    expect(occurrences.some((item) => item.status === 'confirmed')).toBe(false)
    expect(occurrences.filter((item) => item.status === 'overdue')).toHaveLength(3)
  })

  it('cerrar una regla nunca la alarga', () => {
    const ended = { ...rent, endDate: d('2026-09-30') }
    const { closed, next } = rescheduleRule(ended, d('2026-11-10'), { id: toId('arriendo-2'), startDate: d('2026-12-10') })
    expect(closed.endDate).toBe('2026-09-30')
    // The new rule does not inherit an end that is already behind its start...
    expect(next.endDate).toBeUndefined()
    // ...but keeps one that is still ahead.
    const lasting = { ...rent, endDate: d('2027-06-30') }
    expect(rescheduleRule(lasting, d('2026-11-10'), { id: toId('arriendo-2'), startDate: d('2026-12-10') }).next.endDate).toBe(
      '2027-06-30',
    )
  })

  it('no corta la regla antes de un pago que ya se hizo por adelantado', () => {
    const december = expense('adelantado', '2026-11-10', 400_000, CHECKING, {
      categoryId: cat('arriendo'),
      occurrence: { ruleId: rent.id, dueDate: d('2026-12-05') },
    })
    const next = { id: toId<'rule'>('arriendo-2'), startDate: d('2026-12-10') }
    expect(() => rescheduleRule(rent, d('2026-11-20'), next, [...paid, december])).toThrow(DomainError)
    expect(() => rescheduleRule(rent, d('2026-12-05'), next, [...paid, december])).not.toThrow()
    expect(() => rescheduleRule(rent, d('2026-11-20'), next, [...paid, { ...december, voided: true }])).not.toThrow()
  })

  it('rechaza cambios que se pisan con el pasado', () => {
    expect(() => rescheduleRule(rent, d('2026-08-04'), { id: toId('x'), startDate: d('2026-12-10') })).toThrow(DomainError)
    expect(() => rescheduleRule(rent, d('2026-11-05'), { id: toId('x'), startDate: d('2026-11-05') })).toThrow(DomainError)
    expect(() => rescheduleRule(rent, d('2026-11-05'), { id: rent.id, startDate: d('2026-12-10') })).toThrow(DomainError)
  })
})
