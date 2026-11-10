import { describe, expect, it } from 'vitest'
import { indexAccounts } from './accounts'
import { accountBalance } from './balances'
import { coverageCandidates } from './coverage'
import { defaultInstallmentPlan } from './credit-card'
import { yearMonth } from './dates'
import { DomainError } from './errors'
import { toId } from './ids'
import { type HouseholdView, type SnapshotInput, availableToSpend, financialSnapshot } from './magnitudes'
import { add, sum } from './money'
import { confirmOccurrence } from './recurring'
import {
  CARD,
  CASH,
  CHECKING,
  DIEGO,
  MEMBERS,
  PABLO,
  SAVINGS,
  account,
  baseAccounts,
  cat,
  clp,
  d,
  expense,
  goal,
  income,
  reservation,
  rule,
  settlement,
  settlementMove,
  sharedExpense,
  sharedPayment,
  transfer,
} from './testing/builders'

const today = d('2026-11-10')

function input(overrides: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    accounts: baseAccounts({ checking: 1_000_000 }),
    transactions: [],
    rules: [],
    cancelledOccurrences: [],
    budgets: [],
    goals: [],
    reservations: [],
    today,
    ...overrides,
  }
}

const budget = (category: string, planned: number) => ({
  categoryId: cat(category),
  month: yearMonth('2026-11'),
  planned: clp(planned),
  funded: true,
})

describe('disponible para gastar', () => {
  it('es saldo líquido menos obligaciones menos reservas, y se explica paso a paso', () => {
    const available = availableToSpend(clp(1_000_000), clp(480_000), clp(100_000))
    expect(available.available).toBe(420_000)
    expect(available.steps).toEqual([
      { code: 'liquid_balance', amount: 1_000_000 },
      { code: 'pending_obligations', amount: -480_000 },
      { code: 'reserved', amount: -100_000 },
      { code: 'available_to_spend', amount: 420_000 },
    ])
    expect(sum(available.steps.slice(0, 3).map((step) => step.amount))).toBe(available.available)
  })

  const pabloHousehold: HouseholdView = {
    memberId: PABLO,
    members: MEMBERS,
    expenses: [sharedExpense('s1', '2026-11-08', 60_000, DIEGO)],
    settlements: [],
  }
  const scenario = input({
    transactions: [
      // Bought on the card in October: the instalment fell due on 5 November and is still unpaid.
      expense('e1', '2026-10-20', 50_000, CARD, { installments: { count: 1, firstDueDate: d('2026-11-05') } }),
    ],
    rules: [rule('arriendo', '2026-11-15', 400_000)],
    goals: [goal('viaje', 1_000_000)],
    reservations: [reservation('r1', 'viaje', '2026-11-02', 100_000)],
    household: pabloHousehold,
  })

  it('reúne las magnitudes sin mezclarlas', () => {
    const snapshot = financialSnapshot(scenario)

    expect(accountBalance(snapshot.balances, CHECKING)).toBe(1_000_000)
    expect(accountBalance(snapshot.balances, CARD)).toBe(-50_000)
    expect(snapshot.totalBalance).toBe(1_000_000)
    expect(snapshot.liquidBalance).toBe(1_000_000)

    expect(snapshot.obligations.map((item) => [item.source, item.dueDate, item.amount])).toEqual([
      ['card', '2026-11-05', 50_000],
      ['household', '2026-11-10', 30_000],
      ['scheduled', '2026-11-15', 400_000],
    ])
    expect(snapshot.obligationsTotal).toBe(480_000)

    expect(snapshot.reserves).toEqual([{ kind: 'goal', ref: 'viaje', amount: 100_000 }])
    expect(snapshot.reservedTotal).toBe(100_000)

    expect(snapshot.available.available).toBe(420_000)

    // Card debt 50.000 and 30.000 owed to the household are liabilities.
    expect(snapshot.netWorth).toEqual({ assets: 1_000_000, liabilities: 80_000, net: 920_000 })
    expect(snapshot.savings).toBe(100_000)

    // November so far: only Pablo's half of the shared purchase. The card purchase was October's.
    expect(snapshot.totals.expense).toBe(30_000)
    expect(snapshot.totals.income).toBe(0)
  })

  it('confirmar un pago programado no cambia lo disponible: deja de ser obligación y pasa a ser gasto', () => {
    const before = financialSnapshot(scenario)
    const rent = before.occurrences.find((item) => item.ruleId === 'arriendo')
    if (rent === undefined) {
      throw new Error('falta el arriendo programado')
    }
    const paid = confirmOccurrence(
      rent,
      { id: toId('tx-arriendo'), date: today },
      { accounts: before.accountIndex, transactions: scenario.transactions, today },
    )
    const after = financialSnapshot({ ...scenario, transactions: [...scenario.transactions, paid] })

    expect(after.liquidBalance).toBe(600_000)
    expect(after.obligationsTotal).toBe(80_000)
    expect(after.available.available).toBe(before.available.available)
    expect(after.totals.expense).toBe(430_000)
  })

  it('un movimiento fechado en el futuro no esconde la obligación ni toca el saldo', () => {
    // Somebody stored the rent as «paid» on the 15th, five days from now.
    const premature = expense('tx', '2026-11-15', 400_000, CHECKING, {
      categoryId: cat('arriendo'),
      occurrence: { ruleId: toId('arriendo'), dueDate: d('2026-11-15') },
    })
    const snapshot = financialSnapshot({ ...scenario, transactions: [...scenario.transactions, premature] })
    expect(snapshot.liquidBalance).toBe(1_000_000)
    expect(snapshot.obligationsTotal).toBe(480_000)
    expect(snapshot.available.available).toBe(420_000)

    // On the 15th the movement happens: the balance goes down and the obligation is settled.
    const later = financialSnapshot({ ...scenario, transactions: [...scenario.transactions, premature], today: d('2026-11-15') })
    expect(later.liquidBalance).toBe(600_000)
    expect(later.available.available).toBe(420_000)
  })

  it('un presupuesto con fondo no reserva de nuevo lo que ya está programado', () => {
    expect(financialSnapshot({ ...scenario, budgets: [budget('arriendo', 400_000)] }).available.available).toBe(420_000)

    const snapshot = financialSnapshot({ ...scenario, budgets: [budget('supermercado', 200_000)] })
    // 200.000 planned minus the 30.000 already spent (Pablo's half of the shared purchase).
    expect(snapshot.reserves).toContainEqual({ kind: 'budget', ref: 'supermercado', amount: 170_000 })
    expect(snapshot.available.available).toBe(250_000)
  })

  it('un gasto atrasado de otro mes no le quita reserva al presupuesto de este mes', () => {
    const rent = rule('arriendo', '2026-10-05', 400_000, { endDate: d('2026-10-31') })
    const snapshot = financialSnapshot(input({ rules: [rent], budgets: [budget('arriendo', 400_000)] }))
    // October's rent is still owed (400.000) and November's budget keeps its 400.000 apart.
    expect(snapshot.obligationsTotal).toBe(400_000)
    expect(snapshot.reservedTotal).toBe(400_000)
    expect(snapshot.available.available).toBe(200_000)
  })

  it('una obligación del mes siguiente todavía no se descuenta', () => {
    const snapshot = financialSnapshot(input({ rules: [rule('arriendo', '2026-12-05', 400_000)] }))
    expect(snapshot.obligationsTotal).toBe(0)
    expect(snapshot.available.available).toBe(1_000_000)
  })

  it('no arrastra obligaciones anteriores al saldo inicial de la cuenta', () => {
    const recent = [account(CHECKING, 'checking', 1_000_000, { openingDate: d('2026-11-01') })]
    const snapshot = financialSnapshot(input({ accounts: recent, rules: [rule('arriendo', '2026-06-05', 400_000)] }))
    expect(snapshot.obligations.map((item) => item.dueDate)).toEqual(['2026-11-05'])
    expect(snapshot.available.available).toBe(600_000)
  })

  it('un ingreso esperado no aumenta lo disponible hasta que se recibe', () => {
    const fee = rule('proyecto', '2026-11-28', 600_000, { kind: 'income', amountIsEstimate: true, categoryId: cat('proyecto') })
    const expected = financialSnapshot(input({ rules: [fee] }))
    expect(expected.liquidBalance).toBe(1_000_000)
    expect(expected.totals.income).toBe(0)
    expect(expected.available.available).toBe(1_000_000)

    const received = financialSnapshot(
      input({ rules: [fee], transactions: [income('i1', '2026-11-09', 540_000, CHECKING, { categoryId: cat('proyecto') })] }),
    )
    expect(received.liquidBalance).toBe(1_540_000)
    expect(received.totals.income).toBe(540_000)
  })
})

describe('la tarjeta no es plata gratis', () => {
  const card = account(CARD, 'credit_card', 0, { paymentDay: 5 })
  const onCard = (amount: number, count = 1) =>
    expense('compra', '2026-11-10', amount, CARD, { installments: defaultInstallmentPlan(card, today, count) })

  it('comprar con tarjeta baja lo disponible de inmediato, igual que pagar con débito', () => {
    const byDebit = financialSnapshot(input({ transactions: [expense('compra', '2026-11-10', 900_000)] }))
    const byCard = financialSnapshot(input({ transactions: [onCard(900_000)] }))
    expect(byDebit.available.available).toBe(100_000)
    expect(byCard.available.available).toBe(100_000)
    expect(byCard.liquidBalance).toBe(1_000_000)
    expect(byCard.obligations).toMatchObject([{ source: 'card', dueDate: '2026-12-05', amount: 900_000 }])
  })

  it('con un presupuesto con fondo, pagar con tarjeta o con débito deja lo mismo disponible', () => {
    const budgets = [budget('supermercado', 200_000)]
    const before = financialSnapshot(input({ budgets }))
    const byDebit = financialSnapshot(input({ budgets, transactions: [expense('compra', '2026-11-10', 50_000)] }))
    const byCard = financialSnapshot(input({ budgets, transactions: [onCard(50_000)] }))
    expect(before.available.available).toBe(800_000)
    expect(byDebit.available.available).toBe(800_000)
    expect(byCard.available.available).toBe(800_000)
  })

  it('de una compra en cuotas solo se descuenta la cuota de la próxima cuenta', () => {
    const snapshot = financialSnapshot(input({ transactions: [onCard(600_000, 6)] }))
    expect(snapshot.obligationsTotal).toBe(100_000)
    expect(snapshot.available.available).toBe(900_000)
    expect(snapshot.netWorth.liabilities).toBe(600_000)
  })

  it('un gasto programado con tarjeta cuenta desde el primer día del mes, igual que uno con débito', () => {
    const subscription = (accountId: typeof CARD) =>
      rule('streaming', '2026-11-28', 9_990, { accountId, categoryId: cat('suscripciones') })
    // The charge of the 28th leaves the account with the bill of 5 December, but it is owed all month.
    for (const day of ['2026-11-01', '2026-11-04', '2026-11-05', '2026-11-27']) {
      const byCard = financialSnapshot(input({ rules: [subscription(CARD)], today: d(day) }))
      const byDebit = financialSnapshot(input({ rules: [subscription(CHECKING)], today: d(day) }))
      expect(byCard.obligations).toMatchObject([{ source: 'scheduled', dueDate: '2026-12-05', amount: 9_990 }])
      expect(byCard.available.available).toBe(990_010)
      expect(byDebit.available.available).toBe(990_010)
    }
    // Next month's charge is not owed yet, on the card or by debit.
    const december = rule('streaming', '2026-12-10', 9_990, { accountId: CARD, categoryId: cat('suscripciones') })
    expect(financialSnapshot(input({ rules: [december] })).obligationsTotal).toBe(0)
  })

  it('con un presupuesto con fondo, el cargo programado a la tarjeta nunca queda sin contar', () => {
    const streaming = rule('streaming', '2026-11-28', 9_990, { accountId: CARD, categoryId: cat('suscripciones') })
    const withBudget = { rules: [streaming], budgets: [budget('suscripciones', 30_000)] }
    // 30.000 are set apart for subscriptions all month: 9.990 as an obligation, the rest as a reserve.
    for (const day of ['2026-11-01', '2026-11-04', '2026-11-05', '2026-11-20', '2026-11-27']) {
      const snapshot = financialSnapshot(input({ ...withBudget, today: d(day) }))
      expect(snapshot.obligationsTotal).toBe(9_990)
      expect(snapshot.reservedTotal).toBe(20_010)
      expect(snapshot.available.available).toBe(970_000)
    }
  })

  it('un gasto programado desde la cuenta de ahorro no es obligación, y el presupuesto con fondo lo sigue cubriendo', () => {
    const fromSavings = rule('seguro', '2026-11-20', 25_000, { accountId: SAVINGS, categoryId: cat('salud') })
    const snapshot = financialSnapshot(input({ rules: [fromSavings], budgets: [budget('salud', 40_000)] }))
    expect(snapshot.obligationsTotal).toBe(0)
    expect(snapshot.reservedTotal).toBe(40_000)
  })

  it('confirmar un cargo programado a la tarjeta en su fecha no cambia lo disponible', () => {
    const streaming = rule('streaming', '2026-11-02', 9_990, { accountId: CARD, categoryId: cat('suscripciones') })
    const base = input({ rules: [streaming] })
    const before = financialSnapshot(base)
    const charge = before.occurrences[0]
    if (charge === undefined) {
      throw new Error('falta el cargo programado')
    }
    const confirmed = confirmOccurrence(
      charge,
      { id: toId('tx'), date: d('2026-11-02') },
      { accounts: indexAccounts(base.accounts), transactions: [], today },
    )
    const after = financialSnapshot({ ...base, transactions: [confirmed] })
    expect(before.obligations).toMatchObject([{ source: 'scheduled', dueDate: '2026-11-05', amount: 9_990 }])
    expect(after.obligations).toMatchObject([{ source: 'card', dueDate: '2026-11-05', amount: 9_990 }])
    expect(after.available.available).toBe(before.available.available)
  })

  it('pagar la tarjeta no cambia el patrimonio: baja el activo y baja el pasivo', () => {
    const purchase = expense('e1', '2026-11-03', 80_000, CARD)
    const before = financialSnapshot(input({ transactions: [purchase] }))
    const after = financialSnapshot(
      input({ transactions: [purchase, transfer('t1', '2026-11-09', 80_000, CHECKING, CARD)] }),
    )
    expect(before.netWorth).toEqual({ assets: 1_000_000, liabilities: 80_000, net: 920_000 })
    expect(after.netWorth).toEqual({ assets: 920_000, liabilities: 0, net: 920_000 })
    expect(after.totals.expense).toBe(80_000)
    expect(after.available.available).toBe(before.available.available)
  })
})

describe('ahorro: reservar no es lo mismo que transferir', () => {
  const base = input({ goals: [goal('viaje', 1_000_000)] })

  it('la reserva deja el dinero en la cuenta y lo aparta de lo disponible', () => {
    const snapshot = financialSnapshot({ ...base, reservations: [reservation('r1', 'viaje', '2026-11-05', 150_000)] })
    expect(snapshot.liquidBalance).toBe(1_000_000)
    expect(snapshot.totalBalance).toBe(1_000_000)
    expect(snapshot.available.available).toBe(850_000)
    expect(snapshot.savings).toBe(150_000)
    expect(snapshot.totals.expense).toBe(0)
  })

  it('la transferencia efectiva cambia los saldos de las cuentas', () => {
    const snapshot = financialSnapshot({
      ...base,
      transactions: [transfer('t1', '2026-11-05', 150_000, CHECKING, SAVINGS, { goalId: toId('viaje') })],
    })
    expect(snapshot.liquidBalance).toBe(850_000)
    expect(accountBalance(snapshot.balances, SAVINGS)).toBe(150_000)
    expect(snapshot.totalBalance).toBe(1_000_000)
    expect(snapshot.available.available).toBe(850_000)
    expect(snapshot.savings).toBe(150_000)
    expect(snapshot.totals.expense).toBe(0)
    expect(snapshot.goals[0]).toMatchObject({ transferred: 150_000, reserved: 0 })
  })

  it('archivar una meta libera lo que tenía reservado', () => {
    const snapshot = financialSnapshot({
      ...base,
      goals: [goal('viaje', 1_000_000, { archived: true })],
      reservations: [reservation('r1', 'viaje', '2026-11-05', 150_000)],
    })
    expect(snapshot.goals).toEqual([])
    expect(snapshot.reservedTotal).toBe(0)
    expect(snapshot.available.available).toBe(1_000_000)
  })
})

describe('gasto compartido visto desde cada teléfono', () => {
  const groceries = sharedExpense('s1', '2026-11-09', 200_000, DIEGO)
  const view = (memberId: typeof DIEGO, settlements = [] as HouseholdView['settlements']): HouseholdView => ({
    memberId,
    members: MEMBERS,
    expenses: [groceries],
    settlements,
  })
  const accounts = baseAccounts({ checking: 500_000 })
  const diegoPaid = sharedPayment('p1', '2026-11-09', 200_000, CHECKING, 's1')

  it('Diego pagó $200.000: su gasto es $100.000 y el hogar le debe $100.000', () => {
    const diego = financialSnapshot(input({ accounts, transactions: [diegoPaid], household: view(DIEGO) }))
    expect(diego.liquidBalance).toBe(300_000)
    expect(diego.totals.expense).toBe(100_000)
    expect(diego.householdBalance).toBe(100_000)
    expect(diego.obligationsTotal).toBe(0)
    expect(diego.netWorth.net).toBe(400_000)
  })

  it('Pablo no ha movido dinero: su gasto es $100.000 y debe $100.000', () => {
    const pablo = financialSnapshot(input({ accounts, household: view(PABLO) }))
    expect(pablo.liquidBalance).toBe(500_000)
    expect(pablo.totals.expense).toBe(100_000)
    expect(pablo.householdBalance).toBe(-100_000)
    expect(pablo.obligationsTotal).toBe(100_000)
    expect(pablo.available.available).toBe(400_000)
    expect(pablo.netWorth.net).toBe(400_000)
  })

  it('el reembolso salda la deuda y no es un segundo gasto ni un ingreso', () => {
    const repaid = [settlement('st1', '2026-11-10', PABLO, DIEGO, 100_000)]
    const pablo = financialSnapshot(
      input({
        accounts,
        transactions: [settlementMove('m1', '2026-11-10', 100_000, CHECKING, 'paid', 'st1')],
        household: view(PABLO, repaid),
      }),
    )
    expect(pablo.liquidBalance).toBe(400_000)
    expect(pablo.householdBalance).toBe(0)
    expect(pablo.totals.expense).toBe(100_000)
    expect(pablo.available.available).toBe(400_000)

    const diego = financialSnapshot(
      input({
        accounts,
        transactions: [diegoPaid, settlementMove('m2', '2026-11-10', 100_000, CHECKING, 'received', 'st1')],
        household: view(DIEGO, repaid),
      }),
    )
    expect(diego.liquidBalance).toBe(400_000)
    expect(diego.householdBalance).toBe(0)
    expect(diego.totals.income).toBe(0)
    expect(diego.totals.expense).toBe(100_000)
    expect(add(diego.netWorth.net, pablo.netWorth.net)).toBe(800_000)
  })

  it('rechaza una vista del hogar de alguien que no es miembro', () => {
    expect(() => financialSnapshot(input({ household: { ...view(DIEGO), memberId: toId('otro') } }))).toThrow(DomainError)
  })
})

describe('un arriendo compartido y además programado no se cuenta dos veces', () => {
  const sharedRent = sharedExpense('renta-nov', '2026-11-05', 400_000, DIEGO, undefined, { categoryId: cat('arriendo') })
  const household = (memberId: typeof DIEGO): HouseholdView => ({
    memberId,
    members: MEMBERS,
    expenses: [sharedRent],
    settlements: [],
  })

  it('para quien no pagó: la deuda con el hogar reemplaza a la obligación programada', () => {
    // Pablo programmed his half of the rent. Diego paid the whole rent and shared it.
    const pabloRule = rule('arriendo', '2026-11-05', 200_000)
    const uncovered = financialSnapshot(input({ rules: [pabloRule], household: household(PABLO) }))
    expect(uncovered.obligationsTotal).toBe(400_000)

    const covered = financialSnapshot(
      input({
        rules: [pabloRule],
        household: household(PABLO),
        sharedCoverage: [{ ref: { ruleId: pabloRule.id, dueDate: d('2026-11-05') }, sharedExpenseId: sharedRent.id }],
      }),
    )
    expect(covered.obligations.map((item) => [item.source, item.amount])).toEqual([['household', 200_000]])
    expect(covered.totals.expense).toBe(200_000)
    expect(covered.available.available).toBe(800_000)

    // If the shared expense is voided, the coverage no longer holds and the rent is owed again.
    const voided = financialSnapshot(
      input({
        rules: [pabloRule],
        household: { ...household(PABLO), expenses: [{ ...sharedRent, voided: true }] },
        sharedCoverage: [{ ref: { ruleId: pabloRule.id, dueDate: d('2026-11-05') }, sharedExpenseId: sharedRent.id }],
      }),
    )
    expect(voided.obligations.map((item) => [item.source, item.amount])).toEqual([['scheduled', 200_000]])
  })

  it('una cobertura que no tiene sentido se ignora: el gasto programado sigue pendiente', () => {
    const pabloRule = rule('arriendo', '2026-11-05', 200_000)
    const ref = { ruleId: pabloRule.id, dueDate: d('2026-11-05') }
    const scheduledOwed = (expenses: HouseholdView['expenses'], sharedExpenseId: string) =>
      financialSnapshot(
        input({
          rules: [pabloRule],
          household: { ...household(PABLO), expenses },
          sharedCoverage: [{ ref, sharedExpenseId: toId(sharedExpenseId) }],
        }),
      ).obligations.filter((item) => item.source === 'scheduled')

    // A taxi cannot cover the rent: another category.
    const taxi = sharedExpense('taxi', '2026-11-05', 10_000, DIEGO, undefined, { categoryId: cat('transporte') })
    expect(scheduledOwed([taxi], 'taxi')).toHaveLength(1)
    // A shared expense that Pablo paid himself, or one he takes no part in, covers nothing of his.
    const ownPayment = sharedExpense('propio', '2026-11-05', 400_000, PABLO, undefined, { categoryId: cat('arriendo') })
    expect(scheduledOwed([ownPayment], 'propio')).toHaveLength(1)
    const notHis = sharedExpense('ajeno', '2026-11-05', 400_000, DIEGO, [{ participantId: DIEGO, weight: 1 }], {
      categoryId: cat('arriendo'),
    })
    expect(scheduledOwed([notHis], 'ajeno')).toHaveLength(1)
    // And one that does not exist.
    expect(scheduledOwed([sharedRent], 'no-existe')).toHaveLength(1)
    expect(scheduledOwed([sharedRent], 'renta-nov')).toHaveLength(0)
  })

  it('propone la cobertura cuando un gasto compartido parece ser el mismo gasto programado', () => {
    const pabloRule = rule('arriendo', '2026-11-05', 200_000)
    const snapshot = financialSnapshot(input({ rules: [pabloRule], household: household(PABLO) }))
    const candidates = coverageCandidates(snapshot.occurrences, PABLO, [sharedRent], [], today)
    expect(candidates).toEqual([{ ref: { ruleId: 'arriendo', dueDate: '2026-11-05' }, sharedExpenseId: 'renta-nov' }])
    // Once it is covered, there is nothing left to propose.
    expect(coverageCandidates(snapshot.occurrences, PABLO, [sharedRent], candidates, today)).toEqual([])
    // Diego paid it himself: for him there is nothing to cover.
    expect(coverageCandidates(snapshot.occurrences, DIEGO, [sharedRent], [], today)).toEqual([])
  })

  it('para quien pagó: el pago confirma la regla y su gasto es solo su parte', () => {
    const diegoRule = rule('arriendo', '2026-11-05', 400_000)
    const before = financialSnapshot(input({ rules: [diegoRule] }))
    expect(before.available.available).toBe(600_000)

    const due = before.occurrences[0]
    if (due === undefined) {
      throw new Error('falta el arriendo programado')
    }
    const payment = confirmOccurrence(
      due,
      { id: toId('pago'), date: d('2026-11-05'), sharedExpenseId: sharedRent.id },
      { accounts: before.accountIndex, transactions: [], today },
    )
    const after = financialSnapshot(input({ rules: [diegoRule], transactions: [payment], household: household(DIEGO) }))
    expect(after.liquidBalance).toBe(600_000)
    expect(after.obligationsTotal).toBe(0)
    expect(after.householdBalance).toBe(200_000)
    expect(after.totals.expense).toBe(200_000)
    expect(after.available.available).toBe(600_000)
  })
})

describe('efectivo y cuentas', () => {
  it('el efectivo es saldo líquido y una cuenta archivada sigue contando', () => {
    const accounts = [
      account(CASH, 'cash', 20_000),
      account(CHECKING, 'checking', 100_000, { archived: true }),
      account(SAVINGS, 'savings', 300_000),
    ]
    const snapshot = financialSnapshot(input({ accounts }))
    expect(snapshot.liquidBalance).toBe(120_000)
    expect(snapshot.totalBalance).toBe(420_000)
    expect(snapshot.savings).toBe(300_000)
  })
})
