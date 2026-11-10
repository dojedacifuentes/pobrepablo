import { type Account, type AccountIndex, accountClass, requireAccount } from './accounts'
import type { Category } from './categories'
import type { LocalDate } from './dates'
import { invariant } from './errors'
import type {
  AccountId,
  CategoryId,
  GoalId,
  RuleId,
  SettlementId,
  SharedExpenseId,
  TransactionId,
} from './ids'
import { type Money, negate, subtract } from './money'

/** Points at one programmed occurrence of a recurring rule. Confirming it must happen only once. */
export interface OccurrenceRef {
  readonly ruleId: RuleId
  readonly dueDate: LocalDate
}

/**
 * How a credit-card purchase will be paid: `count` monthly instalments starting on `firstDueDate`.
 * `dueDay` is the card's payment day, so that a card paid on the 31st keeps falling on the last
 * day of each month instead of sticking to the 28th after February.
 */
export interface InstallmentPlan {
  readonly count: number
  readonly firstDueDate: LocalDate
  readonly dueDay?: number
}

/** Fee income (honorarios): gross and withholding are informative; only the net amount is money. */
export interface HonorariumBreakdown {
  readonly gross: Money
  readonly withholding: Money
}

interface TransactionBase {
  readonly id: TransactionId
  /** The day it really happened. Never in the future: what is still to come is programmed. */
  readonly date: LocalDate
  /** Positive for every kind except `adjustment`, which is signed. */
  readonly amount: Money
  /** A voided movement stays in the history but no longer counts anywhere. */
  readonly voided: boolean
  readonly note?: string
}

/** A purchase or payment. On a credit card it is the expense and it creates the debt. */
export interface Expense extends TransactionBase {
  readonly kind: 'expense'
  readonly accountId: AccountId
  readonly categoryId: CategoryId
  readonly installments?: InstallmentPlan
  readonly occurrence?: OccurrenceRef
}

/** Money received. `amount` is always the net amount that actually arrived. */
export interface Income extends TransactionBase {
  readonly kind: 'income'
  readonly accountId: AccountId
  readonly categoryId: CategoryId
  readonly honorarium?: HonorariumBreakdown
  readonly occurrence?: OccurrenceRef
}

/** Money moved between own accounts. Never income, never expense. Paying a card is a transfer. */
export interface Transfer extends TransactionBase {
  readonly kind: 'transfer'
  readonly fromAccountId: AccountId
  readonly toAccountId: AccountId
  /** Marks an effective contribution to (or withdrawal from) a savings goal. */
  readonly goalId?: GoalId
  readonly occurrence?: OccurrenceRef
}

/**
 * The cash that left an account to pay a shared household expense. It is not the expense itself:
 * the member's own share is recognised through the household, and the rest is owed back.
 * It always travels together with its `SharedExpense` (see `household-ledger.ts`).
 */
export interface SharedPayment extends TransactionBase {
  readonly kind: 'shared_payment'
  readonly accountId: AccountId
  readonly sharedExpenseId: SharedExpenseId
  readonly installments?: InstallmentPlan
  readonly occurrence?: OccurrenceRef
}

/** A reimbursement between household members. Neither income nor expense. */
export interface SettlementMovement extends TransactionBase {
  readonly kind: 'settlement'
  readonly accountId: AccountId
  readonly direction: 'paid' | 'received'
  readonly settlementId: SettlementId
}

/** Corrects a balance that drifted from reality. Signed; neither income nor expense. */
export interface Adjustment extends TransactionBase {
  readonly kind: 'adjustment'
  readonly accountId: AccountId
}

export type Transaction = Expense | Income | Transfer | SharedPayment | SettlementMovement | Adjustment

export interface BalanceDelta {
  readonly accountId: AccountId
  readonly delta: Money
}

export const MAX_INSTALLMENTS = 60

/** What a movement does to account balances. A voided movement does nothing. */
export function balanceDeltas(transaction: Transaction): readonly BalanceDelta[] {
  if (transaction.voided) {
    return []
  }
  switch (transaction.kind) {
    case 'expense':
    case 'shared_payment':
      return [{ accountId: transaction.accountId, delta: negate(transaction.amount) }]
    case 'income':
    case 'adjustment':
      return [{ accountId: transaction.accountId, delta: transaction.amount }]
    case 'transfer':
      return [
        { accountId: transaction.fromAccountId, delta: negate(transaction.amount) },
        { accountId: transaction.toAccountId, delta: transaction.amount },
      ]
    case 'settlement':
      return [
        {
          accountId: transaction.accountId,
          delta: transaction.direction === 'paid' ? negate(transaction.amount) : transaction.amount,
        },
      ]
  }
}

export function accountIdsOf(transaction: Transaction): readonly AccountId[] {
  return transaction.kind === 'transfer'
    ? [transaction.fromAccountId, transaction.toAccountId]
    : [transaction.accountId]
}

export function occurrenceOf(transaction: Transaction): OccurrenceRef | undefined {
  switch (transaction.kind) {
    case 'expense':
    case 'income':
    case 'transfer':
    case 'shared_payment':
      return transaction.occurrence
    case 'settlement':
    case 'adjustment':
      return undefined
  }
}

export function voidTransaction<T extends Transaction>(transaction: T): T {
  return { ...transaction, voided: true }
}

export interface ValidationContext {
  readonly accounts: AccountIndex
  readonly today: LocalDate
  /** When given, an expense must use an expense category and an income an income category. */
  readonly categories?: ReadonlyMap<CategoryId, Category>
}

function validateInstallments(
  plan: InstallmentPlan | undefined,
  transaction: Transaction,
  account: Account,
): void {
  if (plan === undefined) {
    return
  }
  invariant(account.kind === 'credit_card', 'Solo una compra con tarjeta de crédito puede ir en cuotas')
  invariant(
    Number.isInteger(plan.count) && plan.count >= 1 && plan.count <= MAX_INSTALLMENTS,
    `Cantidad de cuotas inválida: ${String(plan.count)}`,
  )
  invariant(plan.count <= transaction.amount, 'Hay más cuotas que pesos: alguna cuota quedaría en cero')
  invariant(plan.firstDueDate >= transaction.date, 'La primera cuota no puede vencer antes de la compra')
  invariant(
    plan.dueDay === undefined || (Number.isInteger(plan.dueDay) && plan.dueDay >= 1 && plan.dueDay <= 31),
    `Día de vencimiento inválido: ${String(plan.dueDay)}`,
  )
}

function validateCategory(
  transaction: Expense | Income,
  categories: ReadonlyMap<CategoryId, Category> | undefined,
): void {
  if (categories === undefined) {
    return
  }
  const category = categories.get(transaction.categoryId)
  invariant(category !== undefined, `La categoría no existe: ${transaction.categoryId}`)
  invariant(
    category.kind === transaction.kind,
    transaction.kind === 'expense'
      ? `«${category.name}» es una categoría de ingreso: no sirve para un gasto`
      : `«${category.name}» es una categoría de gasto: no sirve para un ingreso`,
  )
}

/** Rejects a movement that breaks an accounting rule. Called before anything is stored. */
export function validateTransaction(transaction: Transaction, context: ValidationContext): void {
  const { accounts, today } = context

  if (transaction.kind === 'adjustment') {
    invariant(transaction.amount !== 0, 'Un ajuste de saldo no puede ser de cero pesos')
  } else {
    invariant(transaction.amount > 0, 'El monto debe ser mayor que cero')
  }

  invariant(
    transaction.date <= today,
    'Un movimiento no puede tener fecha futura: lo que todavía no ocurre se programa',
  )

  for (const accountId of accountIdsOf(transaction)) {
    const account = requireAccount(accounts, accountId)
    invariant(
      transaction.date >= account.openingDate,
      `El movimiento es anterior al saldo inicial de la cuenta «${account.name}», que ya lo incluye`,
    )
  }

  switch (transaction.kind) {
    case 'expense':
      validateInstallments(transaction.installments, transaction, requireAccount(accounts, transaction.accountId))
      validateCategory(transaction, context.categories)
      break
    case 'shared_payment':
      validateInstallments(transaction.installments, transaction, requireAccount(accounts, transaction.accountId))
      break
    case 'income':
      validateCategory(transaction, context.categories)
      if (transaction.honorarium !== undefined) {
        const { gross, withholding } = transaction.honorarium
        invariant(withholding >= 0, 'La retención no puede ser negativa')
        invariant(
          subtract(gross, withholding) === transaction.amount,
          'En honorarios, bruto menos retención debe ser igual al líquido recibido',
        )
      }
      break
    case 'transfer': {
      invariant(
        transaction.fromAccountId !== transaction.toAccountId,
        'Una transferencia necesita dos cuentas distintas',
      )
      if (transaction.goalId !== undefined) {
        const fromSavings = accountClass(requireAccount(accounts, transaction.fromAccountId).kind) === 'savings'
        const toSavings = accountClass(requireAccount(accounts, transaction.toAccountId).kind) === 'savings'
        invariant(
          fromSavings !== toSavings,
          'Un aporte a una meta entra a una cuenta de ahorro o sale de ella: una sola de las dos cuentas debe ser de ahorro',
        )
      }
      break
    }
    case 'settlement':
    case 'adjustment':
      break
  }
}
