import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { accountClass, requireAccount } from './accounts'
import { accountBalance } from './balances'
import { defaultInstallmentPlan } from './credit-card'
import { toId } from './ids'
import { type SnapshotInput, financialSnapshot } from './magnitudes'
import { ZERO, add, subtract, sum } from './money'
import { confirmOccurrence, duplicateConfirmations, isAwaiting, isConfirmedByMovement } from './recurring'
import { ALL_ACCOUNTS, arbAccountPair, arbAmount, arbExtraTransaction, arbSnapshotInput } from './testing/arbitraries'
import { CARD, CHECKING, expense, transfer } from './testing/builders'
import { balanceDeltas, voidTransaction } from './transactions'

/**
 * The invariants of the specification, §4.3, checked against whole random financial situations:
 * accounts opened on different days, cards with and without statement day, movements dated
 * before and after «today», confirmed and skipped occurrences, goals, budgets and a household.
 *
 * Where each one lives:
 *
 * - The parts of a split add up to the total ............ split.test.ts
 * - Recomputing equals incremental balances ............... balances.test.ts (against an independent calculation)
 * - Household balances add up to zero .................... household.test.ts (two to five members)
 * - A transfer changes neither totals nor expense ........ here (and balances.test.ts)
 * - Card purchase plus payment is a single expense ....... here
 * - Voiding returns every magnitude to its value ......... here (movements, shared expenses, reimbursements, reservations)
 * - Importing the same backup or package twice ........... data layer (phases 3 and 7)
 */

function cardOf(input: SnapshotInput) {
  const card = input.accounts.find((account) => account.id === CARD)
  if (card === undefined) {
    throw new Error('la situación de prueba no tiene tarjeta')
  }
  return card
}

describe('invariantes §4.3 sobre situaciones completas', () => {
  it('una transferencia no altera el gasto del período ni el patrimonio; entre cuentas propias, tampoco el saldo total', () => {
    fc.assert(
      fc.property(arbSnapshotInput, arbAccountPair(ALL_ACCOUNTS), arbAmount(), (input, [from, to], amount) => {
        const moved = { ...transfer('extra-transfer', input.today, 1, from, to), amount }
        const before = financialSnapshot(input)
        const after = financialSnapshot({ ...input, transactions: [...input.transactions, moved] })

        expect(after.totals).toEqual(before.totals)
        expect(after.netWorth.net).toBe(before.netWorth.net)
        const bothAssets = [from, to].every(
          (accountId) => accountClass(requireAccount(before.accountIndex, accountId).kind) !== 'liability',
        )
        if (bothAssets) {
          expect(after.totalBalance).toBe(before.totalBalance)
        }
      }),
    )
  })

  it('una compra con tarjeta y su pago posterior suman un solo gasto', () => {
    fc.assert(
      fc.property(arbSnapshotInput, arbAmount(), fc.integer({ min: 1, max: 12 }), (input, amount, count) => {
        fc.pre(amount >= count)
        const purchase = {
          ...expense('extra-purchase', input.today, 1, CARD, {
            installments: defaultInstallmentPlan(cardOf(input), input.today, count),
          }),
          amount,
        }
        const payment = { ...transfer('extra-payment', input.today, 1, CHECKING, CARD), amount }

        const base = financialSnapshot(input)
        const bought = financialSnapshot({ ...input, transactions: [...input.transactions, purchase] })
        const paid = financialSnapshot({ ...input, transactions: [...input.transactions, purchase, payment] })

        // The purchase is the expense and creates the debt.
        expect(bought.totals.expense).toBe(add(base.totals.expense, amount))
        expect(bought.netWorth.net).toBe(subtract(base.netWorth.net, amount))
        expect(accountBalance(bought.balances, CARD)).toBe(subtract(accountBalance(base.balances, CARD), amount))
        // Paying the card lowers the debt and is not a second expense.
        expect(paid.totals).toEqual(bought.totals)
        expect(paid.netWorth.net).toBe(bought.netWorth.net)
        expect(accountBalance(paid.balances, CARD)).toBe(accountBalance(base.balances, CARD))
      }),
    )
  })

  it('un movimiento anulado deja todas las magnitudes como si no existiera', () => {
    fc.assert(
      fc.property(arbSnapshotInput, arbExtraTransaction('extra'), (input, makeExtra) => {
        const before = financialSnapshot(input)
        const afterVoiding = financialSnapshot({
          ...input,
          transactions: [...input.transactions, voidTransaction(makeExtra(input.accounts))],
        })
        expect(afterVoiding).toEqual(before)
      }),
    )
  })

  it('anular cualquier movimiento del historial equivale a quitarlo', () => {
    fc.assert(
      fc.property(arbSnapshotInput, fc.nat(), (input, pick) => {
        fc.pre(input.transactions.length > 0)
        const index = pick % input.transactions.length
        const voided = input.transactions.map((transaction, position) =>
          position === index ? voidTransaction(transaction) : transaction,
        )
        const removed = input.transactions.filter((_, position) => position !== index)
        expect(financialSnapshot({ ...input, transactions: voided })).toEqual(
          financialSnapshot({ ...input, transactions: removed }),
        )
      }),
    )
  })

  it('anular un gasto compartido, un reembolso o una reserva equivale a quitarlo', () => {
    fc.assert(
      fc.property(arbSnapshotInput, fc.nat(), (input, pick) => {
        const household = input.household
        if (household === undefined) {
          return
        }
        const voidAt = <T extends { voided: boolean }>(items: readonly T[]) =>
          items.map((item, position) => (position === pick % Math.max(1, items.length) ? { ...item, voided: true } : item))
        const removeAt = <T>(items: readonly T[]) =>
          items.filter((_, position) => position !== pick % Math.max(1, items.length))

        expect(
          financialSnapshot({
            ...input,
            reservations: voidAt(input.reservations),
            household: {
              ...household,
              expenses: voidAt(household.expenses),
              settlements: voidAt(household.settlements),
            },
          }),
        ).toEqual(
          financialSnapshot({
            ...input,
            reservations: removeAt(input.reservations),
            household: {
              ...household,
              expenses: removeAt(household.expenses),
              settlements: removeAt(household.settlements),
            },
          }),
        )
      }),
    )
  })
})

describe('coherencia entre magnitudes', () => {
  it('lo disponible se explica: saldo líquido − obligaciones − reservas', () => {
    fc.assert(
      fc.property(arbSnapshotInput, (input) => {
        const snapshot = financialSnapshot(input)
        const { available } = snapshot

        expect(available.available).toBe(
          subtract(subtract(snapshot.liquidBalance, snapshot.obligationsTotal), snapshot.reservedTotal),
        )
        expect(sum(available.steps.slice(0, 3).map((step) => step.amount))).toBe(available.available)
        expect(sum(snapshot.obligations.map((item) => item.amount))).toBe(snapshot.obligationsTotal)
        expect(sum(snapshot.reserves.map((item) => item.amount))).toBe(snapshot.reservedTotal)
        expect(snapshot.obligations.every((item) => item.amount > 0)).toBe(true)
        expect(snapshot.reserves.every((item) => item.amount > 0)).toBe(true)
        // No obligation is listed twice.
        expect(new Set(snapshot.obligations.map((item) => `${item.source}|${item.ref}`)).size).toBe(
          snapshot.obligations.length,
        )
      }),
    )
  })

  it('el patrimonio neto es la suma de todos los saldos más el saldo interno del hogar', () => {
    fc.assert(
      fc.property(arbSnapshotInput, (input) => {
        const snapshot = financialSnapshot(input)
        const allBalances = sum(snapshot.balances.values())

        expect(snapshot.netWorth.net).toBe(subtract(snapshot.netWorth.assets, snapshot.netWorth.liabilities))
        expect(snapshot.netWorth.net).toBe(add(allBalances, snapshot.householdBalance))
        expect(snapshot.netWorth.assets >= 0 && snapshot.netWorth.liabilities >= 0).toBe(true)
        // Card debt is exactly the negative part of the card balance.
        const cardDebt = snapshot.cardStatements.reduce((total, statement) => add(total, statement.debt), ZERO)
        const card = accountBalance(snapshot.balances, CARD)
        expect(cardDebt).toBe(card < 0 ? subtract(ZERO, card) : ZERO)
      }),
    )
  })

  it('pagar con tarjeta nunca deja más disponible que pagar lo mismo con débito', () => {
    fc.assert(
      fc.property(arbSnapshotInput, arbAmount(), fc.integer({ min: 1, max: 12 }), (input, amount, count) => {
        fc.pre(amount >= count)
        const card = cardOf(input)
        const byDebit = { ...expense('compra', input.today, 1, CHECKING), amount }
        const byCard = {
          ...expense('compra', input.today, 1, CARD, { installments: defaultInstallmentPlan(card, input.today, count) }),
          amount,
        }
        const before = financialSnapshot(input)
        const debit = financialSnapshot({ ...input, transactions: [...input.transactions, byDebit] })
        const credit = financialSnapshot({ ...input, transactions: [...input.transactions, byCard] })

        // Debit: the money leaves at once.
        expect(debit.liquidBalance).toBe(subtract(before.liquidBalance, amount))
        // Card: never better than debit by more than what is not yet billed or what card credit absorbs...
        expect(credit.available.available).toBeGreaterThanOrEqual(debit.available.available)
        // ...and with a single payment and no credit on the card, exactly the same as debit.
        const cardHadNoCredits = before.cardStatements.every(
          (statement) =>
            statement.unappliedCredit === 0 && statement.installments.every((item) => item.outstanding === item.amount),
        )
        if (count === 1 && cardHadNoCredits) {
          expect(credit.available.available).toBe(debit.available.available)
        }
      }),
    )
  })
})

/** The same situation with nothing ever paid into the card, so that every charge stays fully outstanding. */
function withoutCardCredits(input: SnapshotInput): SnapshotInput {
  return {
    ...input,
    accounts: input.accounts.map((account) =>
      account.id === CARD && account.openingBalance > 0 ? { ...account, openingBalance: ZERO } : account,
    ),
    transactions: input.transactions.filter(
      (transaction) => !balanceDeltas(transaction).some(({ accountId, delta }) => accountId === CARD && delta > 0),
    ),
  }
}

describe('confirmar un gasto programado no lo cuenta dos veces', () => {
  it('desde una cuenta líquida, lo disponible no cambia: deja de ser obligación y pasa a ser gasto', () => {
    fc.assert(
      fc.property(arbSnapshotInput, (input) => {
        const before = financialSnapshot(input)
        const candidate = before.occurrences.find(
          (occurrence) =>
            occurrence.kind === 'expense' &&
            isAwaiting(occurrence) &&
            // A movement dated after today may already point at it: that one cannot be confirmed again.
            !isConfirmedByMovement(occurrence, input.transactions) &&
            accountClass(requireAccount(before.accountIndex, occurrence.accountId).kind) === 'liquid',
        )
        fc.pre(candidate !== undefined)
        if (candidate === undefined) {
          return
        }

        // Paid on its date when that date has passed, or today when it is paid early.
        const date = candidate.dueDate <= input.today ? candidate.dueDate : input.today
        const confirmation = confirmOccurrence(
          candidate,
          { id: toId('confirmation'), date },
          { accounts: before.accountIndex, transactions: input.transactions, today: input.today },
        )
        const transactions = [...input.transactions, confirmation]
        const after = financialSnapshot({ ...input, transactions })

        expect(duplicateConfirmations(transactions)).toEqual([])
        expect(after.liquidBalance).toBe(subtract(before.liquidBalance, candidate.amount))
        expect(after.obligationsTotal).toBe(subtract(before.obligationsTotal, candidate.amount))
        expect(after.available.available).toBe(before.available.available)
      }),
    )
  })

  it('con cargo a la tarjeta en su fecha, la obligación solo cambia de nombre', () => {
    fc.assert(
      fc.property(arbSnapshotInput, (raw) => {
        const input = withoutCardCredits(raw)
        const before = financialSnapshot(input)
        const candidate = before.occurrences.find(
          (occurrence) =>
            occurrence.kind === 'expense' &&
            isAwaiting(occurrence) &&
            !isConfirmedByMovement(occurrence, input.transactions) &&
            occurrence.accountId === CARD &&
            occurrence.dueDate <= input.today,
        )
        fc.pre(candidate !== undefined)
        if (candidate === undefined) {
          return
        }

        const confirmation = confirmOccurrence(
          candidate,
          { id: toId('confirmation'), date: candidate.dueDate },
          { accounts: before.accountIndex, transactions: input.transactions, today: input.today },
        )
        const after = financialSnapshot({ ...input, transactions: [...input.transactions, confirmation] })

        expect(after.liquidBalance).toBe(before.liquidBalance)
        expect(after.obligationsTotal).toBe(before.obligationsTotal)
        expect(after.available.available).toBe(before.available.available)
      }),
    )
  })
})
