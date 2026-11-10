import {
  type Category,
  type CategoryId,
  type LedgerIssue,
  type LocalDate,
  addDays,
  duplicateConfirmations,
  financialSnapshot,
  householdLedgerIssues,
  indexAccounts,
  invariant,
  localDate,
  projectScenarios,
  requireAccount,
  validateAccount,
  validateBudget,
  validateGoal,
  validateRule,
  validateSettlement,
  validateSharedExpense,
  validateTransaction,
} from '@/domain'
import { keyText } from '../keys'
import { registeringSince } from '../ledger-issues'
import { toSnapshotInput } from '../ports'
import { DATA_TABLES, type ProfileSnapshot } from '../records'

/**
 * Is this snapshot something the app can live with?
 *
 * A file can have the right shape and still be impossible: a movement on an account that does not
 * exist, two payments for the same programmed rent, a split that adds up to nothing. Storing that
 * would break every screen. `problems` lists whatever makes the snapshot unusable; the caller
 * refuses the import when it is not empty.
 *
 * `ledgerIssues` is different: household records whose counterpart is missing on this phone. They
 * do not break any calculation, so they are not a reason to refuse somebody's backup, but they
 * must be shown to the person.
 */
export interface IntegrityReport {
  readonly problems: string[]
  readonly ledgerIssues: LedgerIssue[]
}

/** Movements dated in the future are tolerated in a file: they simply do not count yet. */
const NO_DATE_LIMIT = localDate('2999-12-31')

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function repeated(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const twice = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) {
      twice.add(value)
    }
    seen.add(value)
  }
  return [...twice]
}

export function checkSnapshot(snapshot: ProfileSnapshot, today: LocalDate): IntegrityReport {
  const problems: string[] = []
  const attempt = (label: string, check: () => void): void => {
    try {
      check()
    } catch (error) {
      problems.push(`${label}: ${reason(error)}`)
    }
  }

  for (const table of DATA_TABLES) {
    const rows: readonly object[] = snapshot[table]
    for (const key of repeated(rows.map((row) => keyText(table, row as Record<string, unknown>)))) {
      problems.push(`Hay un registro repetido en «${table}»: ${key}`)
    }
  }
  for (const id of repeated(snapshot.coverages.map((coverage) => coverage.sharedExpenseId))) {
    problems.push(`Un mismo gasto compartido cubre dos programados: ${id}`)
  }
  const seqs = snapshot.audit.map((entry) => entry.seq)
  if (seqs.some((seq, index) => index > 0 && seq <= (seqs[index - 1] ?? 0))) {
    problems.push('El registro de auditoría no está en orden.')
  }
  const keys = snapshot.audit.flatMap((entry) => (entry.idempotencyKey !== undefined ? [entry.idempotencyKey] : []))
  if (repeated(keys).length > 0) {
    problems.push('El registro de auditoría repite una clave de operación.')
  }

  const memberIds = snapshot.members.map((member) => member.id)
  if (!memberIds.includes(snapshot.meta.memberId)) {
    problems.push('El perfil no figura entre los miembros de su hogar.')
  }

  // Past this point every check needs the accounts to be indexable.
  if (repeated(snapshot.accounts.map((account) => account.id)).length > 0) {
    return { problems, ledgerIssues: [] }
  }
  const accounts = indexAccounts(snapshot.accounts)
  const categories = new Map(snapshot.categories.map((category) => [category.id, category]))

  for (const account of snapshot.accounts) {
    attempt(`Cuenta «${account.name}»`, () => validateAccount(account))
  }
  for (const transaction of snapshot.transactions) {
    // A voided movement no longer counts anywhere: only its shape matters.
    if (!transaction.voided) {
      attempt(`Movimiento ${transaction.id}`, () =>
        validateTransaction(transaction, { accounts, categories, today: NO_DATE_LIMIT }),
      )
    }
  }
  const requireCategoryOf = (id: CategoryId, kind: Category['kind'], what: string): void => {
    const category = categories.get(id)
    invariant(category !== undefined, `La categoría no existe: ${id}`)
    invariant(category.kind === kind, `«${category.name}» no es una categoría de ${what}`)
  }
  const goalIds = new Set<string>(snapshot.goals.map((goal) => goal.id))

  for (const rule of snapshot.rules) {
    attempt(`Recurrente «${rule.label}»`, () => {
      validateRule(rule)
      requireAccount(accounts, rule.accountId)
      if (rule.toAccountId !== undefined) {
        requireAccount(accounts, rule.toAccountId)
      }
      if (rule.kind !== 'transfer' && rule.categoryId !== undefined) {
        requireCategoryOf(rule.categoryId, rule.kind, rule.kind === 'expense' ? 'gasto' : 'ingreso')
      }
    })
  }
  for (const transaction of snapshot.transactions) {
    if (!transaction.voided && transaction.kind === 'transfer' && transaction.goalId !== undefined) {
      attempt(`Movimiento ${transaction.id}`, () =>
        invariant(goalIds.has(transaction.goalId ?? ''), 'La meta de ahorro no existe'),
      )
    }
  }
  for (const reservation of snapshot.reservations) {
    attempt(`Reserva ${reservation.id}`, () => invariant(goalIds.has(reservation.goalId), 'La meta no existe'))
  }
  for (const ref of duplicateConfirmations(snapshot.transactions)) {
    problems.push(`Un mismo programado aparece confirmado dos veces: ${ref.ruleId} del ${ref.dueDate}`)
  }
  for (const expense of snapshot.sharedExpenses) {
    if (!expense.voided) {
      attempt(`Gasto compartido «${expense.description}»`, () => {
        validateSharedExpense(expense, memberIds)
        requireCategoryOf(expense.categoryId, 'expense', 'gasto')
      })
    }
  }
  for (const settlement of snapshot.settlements) {
    if (!settlement.voided) {
      attempt(`Reembolso ${settlement.id}`, () => validateSettlement(settlement, memberIds))
    }
  }
  for (const budget of snapshot.budgets) {
    attempt(`Presupuesto de ${budget.categoryId}`, () => {
      validateBudget(budget)
      requireCategoryOf(budget.categoryId, 'expense', 'gasto')
    })
  }
  for (const goal of snapshot.goals) {
    attempt(`Meta «${goal.name}»`, () => validateGoal(goal))
  }

  // The last word: can every figure of the app be computed from this? If any rule above missed
  // something, this is where it shows, before a single row is stored.
  if (problems.length === 0) {
    const input = toSnapshotInput(snapshot, today)
    attempt('Los datos no se pueden calcular', () => {
      financialSnapshot(input)
      projectScenarios(input, addDays(today, 90))
    })
  }

  // Reported even when something else is wrong: a rescue must not hide them.
  let ledgerIssues: LedgerIssue[] = []
  try {
    ledgerIssues = householdLedgerIssues(
      snapshot.meta.memberId,
      snapshot.transactions,
      snapshot.sharedExpenses,
      snapshot.settlements,
      registeringSince(snapshot.meta, snapshot.accounts),
    )
  } catch (error) {
    problems.push(`El hogar no se puede revisar: ${reason(error)}`)
  }
  return { problems, ledgerIssues }
}
