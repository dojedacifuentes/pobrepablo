import type { Account, LedgerIssue, LedgerIssueKind, LocalDate } from '@/domain'
import type { ProfileInfo } from './records'

const EXPLANATIONS: Readonly<Record<LedgerIssueKind, string>> = {
  payment_without_expense: 'Hay una salida de dinero por un gasto compartido que no existe o está anulado.',
  payment_by_non_payer: 'Hay una salida de dinero por un gasto compartido que pagó otra persona.',
  payment_mismatch: 'La salida de dinero y su gasto compartido no coinciden en el monto o en la fecha.',
  expense_without_payment: 'Falta la salida de dinero de un gasto compartido que pagaste.',
  duplicate_payment: 'Un mismo gasto compartido aparece pagado dos veces.',
  movement_without_settlement: 'Hay un movimiento de reembolso cuyo reembolso no existe o está anulado.',
  movement_mismatch: 'El movimiento de cuenta y su reembolso no coinciden en el monto, la fecha o el sentido.',
  settlement_without_movement: 'Falta el movimiento de cuenta de un reembolso en el que participaste.',
  duplicate_movement: 'Un mismo reembolso aparece dos veces en tus cuentas.',
}

/** A household contradiction in words the person can act on. */
export function describeLedgerIssue(issue: LedgerIssue): string {
  return EXPLANATIONS[issue.kind]
}

/** A text that identifies one issue, to compare the issues before and after an operation. */
export function ledgerIssueKey(issue: LedgerIssue): string {
  return [issue.kind, issue.transactionId ?? '', issue.sharedExpenseId ?? '', issue.settlementId ?? ''].join('|')
}

/**
 * The day from which every household payment of this person must show a cash movement: the day
 * their first account opens. Before that there is no account a movement could be registered on,
 * and the opening balances already include whatever was paid. With no account yet, it is the day
 * the profile was created.
 *
 * It is derived, never stored on its own: a date that could be edited by hand would be a way to
 * make a shared expense and its payment come apart without anything noticing.
 */
export function registeringSince(profile: ProfileInfo, accounts: readonly Account[]): LocalDate {
  return accounts.reduce(
    (earliest, account) => (account.openingDate < earliest ? account.openingDate : earliest),
    accounts[0]?.openingDate ?? profile.startedOn,
  )
}
