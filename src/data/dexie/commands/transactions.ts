import { type Transaction, type TransactionId, occurrenceOf, validateTransaction, voidTransaction } from '@/domain'
import { DataError } from '../../errors'
import type { CommandOptions, NewTransaction, TransactionEdit } from '../../ports'
import type { ReservationRecord } from '../../records'
import { transactionSchema } from '../../schemas'
import { parseInput } from '../../validation'
import { toTransactionRecord } from '../rows'
import { type StoreContext, type UnitOfWork, commit } from '../unit-of-work'
import { type FullValidationContext, found, validationContext, withoutMeta } from './support'

/** The release of a goal's reserve that was stored together with this transfer, if there is one. */
async function fulfilmentOf(unit: UnitOfWork, transactionId: TransactionId): Promise<ReservationRecord | undefined> {
  return unit.db.reservations.where('transferId').equals(transactionId).first()
}

function isHouseholdSide(transaction: Transaction): boolean {
  return transaction.kind === 'shared_payment' || transaction.kind === 'settlement'
}

/** A movement registered by hand passes every accounting rule before it is stored. */
async function validated(unit: UnitOfWork, candidate: unknown): Promise<Transaction> {
  const transaction = parseInput(transactionSchema, candidate)
  if (isHouseholdSide(transaction)) {
    throw new DataError(
      'linked_record',
      'Un pago de gasto compartido o un reembolso se registran desde el Hogar, junto con su contraparte.',
    )
  }
  const context: FullValidationContext = await validationContext(unit)
  validateTransaction(transaction, context)
  if (transaction.kind === 'transfer' && transaction.goalId !== undefined) {
    await found(unit.db.goals.get(transaction.goalId), 'La meta de ahorro no existe.')
  }
  return transaction
}

export function recordTransaction(context: StoreContext, input: NewTransaction, options?: CommandOptions) {
  return commit(context, 'transaction.create', options, input, async (unit) => {
    const transaction = await validated(unit, { ...input, id: input.id ?? unit.newId(), voided: false })
    if (occurrenceOf(transaction) !== undefined) {
      throw new DataError('invalid_input', 'Un movimiento programado se confirma desde su propia operación.')
    }
    await unit.create('transactions', transaction)
    return { transactionId: transaction.id }
  })
}

export function editTransaction(
  context: StoreContext,
  id: TransactionId,
  next: TransactionEdit,
  options?: CommandOptions,
) {
  return commit(context, 'transaction.edit', options, { id, next }, async (unit) => {
    const before = toTransactionRecord(await found(unit.db.transactions.get(id), 'El movimiento no existe.'))
    if (before.voided) {
      throw new DataError('conflict', 'Un movimiento anulado no se edita.')
    }
    if (isHouseholdSide(before)) {
      throw new DataError(
        'linked_record',
        'Este movimiento es la mitad de un registro del hogar: se corrige anulando ese registro y creándolo de nuevo.',
      )
    }
    if (next.kind !== before.kind) {
      throw new DataError('invalid_input', 'El tipo de un movimiento no cambia: anúlalo y regístralo de nuevo.')
    }
    if ('occurrence' in next) {
      throw new DataError('invalid_input', 'Qué programado confirma un movimiento no se cambia al editarlo.')
    }
    if ((await fulfilmentOf(unit, id)) !== undefined) {
      throw new DataError(
        'linked_record',
        'Esta transferencia cumplió una reserva de una meta: para corregirla, anúlala y vuelve a hacerla.',
      )
    }
    // What it confirms stays: the occurrence must not lose its payment because of a correction.
    const occurrence = occurrenceOf(before)
    const edited = await validated(unit, {
      ...next,
      id,
      voided: false,
      ...(occurrence !== undefined ? { occurrence } : {}),
    })
    await unit.replace('transactions', before, edited)
    return { transactionId: id }
  })
}

export function voidTransactionCommand(context: StoreContext, id: TransactionId, options?: CommandOptions) {
  return commit(context, 'transaction.void', options, { id }, async (unit) => {
    const before = toTransactionRecord(await found(unit.db.transactions.get(id), 'El movimiento no existe.'))
    if (!before.voided) {
      // For one side of a household record, the unit of work refuses unless the pair stays coherent.
      await unit.replace('transactions', before, voidTransaction(withoutMeta(before) as Transaction), 'void')
      // The transfer that fulfilled a reserve is undone together with the release of that reserve:
      // voiding one alone would count the same saving twice, or lose it.
      const release = await fulfilmentOf(unit, id)
      if (release !== undefined && !release.voided) {
        await unit.replace('reservations', release, { ...withoutMeta(release), voided: true }, 'void')
      }
    }
    return { transactionId: id }
  })
}
