import type { Account } from './accounts'
import {
  type LocalDate,
  addMonthsAnchored,
  compareDates,
  dayOfMonthOnOrAfter,
  maxDate,
  nextDayOfMonthAfter,
} from './dates'
import { invariant } from './errors'
import { type AccountId, compareIds } from './ids'
import { type Money, ZERO, add, minMoney, negate, subtract } from './money'
import { splitEvenly } from './split'
import { type InstallmentPlan, type Transaction, balanceDeltas } from './transactions'

/** One payment owed to a credit card. `outstanding` is what is still unpaid of it. */
export interface Installment {
  /** The purchase it comes from (a transaction id), or `opening` for the debt the card started with. */
  readonly sourceId: string
  readonly number: number
  readonly count: number
  readonly dueDate: LocalDate
  readonly amount: Money
  readonly outstanding: Money
}

export interface CardStatement {
  readonly accountId: AccountId
  /** What is owed to the card today. Never negative. */
  readonly debt: Money
  /** Money paid to the card beyond what was owed. */
  readonly unappliedCredit: Money
  /** Every instalment, oldest due date first. */
  readonly installments: readonly Installment[]
}

export const OPENING_SOURCE = 'opening'

type Charge = Omit<Installment, 'outstanding'>

function requireCard(card: Account): void {
  invariant(card.kind === 'credit_card', `La cuenta «${card.name}» no es una tarjeta de crédito`)
}

/** The first bill date after `date`, for a card that is paid on `paymentDay` of each month. */
export function nextPaymentDate(date: LocalDate, paymentDay: number): LocalDate {
  return nextDayOfMonthAfter(date, paymentDay)
}

/**
 * The day a charge made on `chargeDate` must be paid.
 *
 * With a statement day: the charge enters the statement that closes on or after its date, and
 * that statement is paid on the next payment day. Without one, the charge is assumed to fall into
 * the very next bill. A card with no payment day at all owes the money on the day of the charge.
 */
export function cardDueDate(card: Account, chargeDate: LocalDate): LocalDate {
  requireCard(card)
  if (card.paymentDay === undefined) {
    return chargeDate
  }
  const closing =
    card.statementDay === undefined ? chargeDate : dayOfMonthOnOrAfter(chargeDate, card.statementDay)
  return nextPaymentDate(closing, card.paymentDay)
}

/** The plan a purchase gets by default: `count` instalments starting on the bill that will include it. */
export function defaultInstallmentPlan(card: Account, purchaseDate: LocalDate, count = 1): InstallmentPlan {
  return {
    count,
    firstDueDate: cardDueDate(card, purchaseDate),
    ...(card.paymentDay !== undefined ? { dueDay: card.paymentDay } : {}),
  }
}

/** The instalments of one purchase. They add up to the purchase; the first ones carry the leftover pesos. */
export function installmentSchedule(sourceId: string, total: Money, plan: InstallmentPlan): Charge[] {
  invariant(total > 0, 'Solo un monto positivo se puede repartir en cuotas')
  return splitEvenly(total, plan.count).map((amount, index) => ({
    sourceId,
    number: index + 1,
    count: plan.count,
    dueDate: index === 0 ? plan.firstDueDate : addMonthsAnchored(plan.firstDueDate, index, plan.dueDay),
    amount,
  }))
}

/**
 * The state of a credit card on `asOf`.
 *
 * Every charge (a purchase, an interest or fee expense, the opening debt) becomes one or more
 * instalments; a charge without an explicit plan goes whole into the bill that includes it.
 * Everything paid into the card (a transfer, a refund) is applied to the oldest instalments first.
 * The purchase was already the expense: paying here only lowers the debt.
 */
export function cardStatement(card: Account, transactions: readonly Transaction[], asOf: LocalDate): CardStatement {
  requireCard(card)

  const charges: Charge[] = []
  let credits = ZERO

  if (card.openingDate <= asOf) {
    if (card.openingBalance < 0) {
      // Debt that existed before the first registered movement: already billed, due on the next payment day.
      charges.push({
        sourceId: OPENING_SOURCE,
        number: 1,
        count: 1,
        dueDate:
          card.paymentDay === undefined ? card.openingDate : nextPaymentDate(card.openingDate, card.paymentDay),
        amount: negate(card.openingBalance),
      })
    } else {
      credits = add(credits, card.openingBalance)
    }
  }

  for (const transaction of transactions) {
    if (transaction.date > asOf) {
      continue
    }
    for (const { accountId, delta } of balanceDeltas(transaction)) {
      if (accountId !== card.id) {
        continue
      }
      if (delta > 0) {
        credits = add(credits, delta)
      } else if (delta < 0) {
        const plan =
          (transaction.kind === 'expense' || transaction.kind === 'shared_payment') &&
          transaction.installments !== undefined
            ? transaction.installments
            : defaultInstallmentPlan(card, transaction.date)
        charges.push(...installmentSchedule(transaction.id, negate(delta), plan))
      }
    }
  }

  charges.sort(
    (a, b) => compareDates(a.dueDate, b.dueDate) || compareIds(a.sourceId, b.sourceId) || a.number - b.number,
  )

  let remainingCredit = credits
  let debt = ZERO
  const installments = charges.map((charge): Installment => {
    const paid = minMoney(charge.amount, remainingCredit)
    remainingCredit = subtract(remainingCredit, paid)
    const outstanding = subtract(charge.amount, paid)
    debt = add(debt, outstanding)
    return { ...charge, outstanding }
  })

  return { accountId: card.id, debt, unappliedCredit: remainingCredit, installments }
}

/** What must be paid to the card on or before `date` and is still unpaid (overdue included). */
export function outstandingDueBy(statement: CardStatement, date: LocalDate): Money {
  let total = ZERO
  for (const installment of statement.installments) {
    if (installment.dueDate <= date) {
      total = add(total, installment.outstanding)
    }
  }
  return total
}

/**
 * How far ahead a card's instalments count as obligations of the period: to the end of the period
 * or to the bill that would include a purchase made today, whichever is later.
 *
 * This is what makes a card purchase lower «available to spend» at once, exactly like paying with
 * a debit card: whatever was bought up to today is always inside this horizon. Later instalments
 * of a purchase in several payments stay out until their own bill approaches.
 */
export function cardObligationHorizon(card: Account, today: LocalDate, periodEnd: LocalDate): LocalDate {
  return maxDate(periodEnd, cardDueDate(card, today))
}
