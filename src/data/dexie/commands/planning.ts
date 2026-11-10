import {
  type Budget,
  type CategoryId,
  type GoalId,
  type GoalReservation,
  type ReservationId,
  type Transaction,
  type YearMonth,
  canRelease,
  fulfilReservation,
  negate,
  toId,
  validateBudget,
  validateGoal,
  voidTransaction,
} from '@/domain'
import { DataError } from '../../errors'
import type { CommandOptions, FulfilInput, GoalEdit, NewGoal, ReservationInput } from '../../ports'
import { budgetSchema, goalSchema, reservationSchema, yearMonthSchema } from '../../schemas'
import { fulfilInputSchema, parseInput, reservationInputSchema } from '../../validation'
import { type StoreContext, type UnitOfWork, commit } from '../unit-of-work'
import { found, notInFuture, requireCategory, validationContext, withoutMeta } from './support'

// ── Budgets ──────────────────────────────────────────────────────────────────────────────────

export function setBudget(context: StoreContext, input: Budget, options?: CommandOptions) {
  return commit(context, 'budget.set', options, input, async (unit) => {
    const budget = parseInput(budgetSchema, input)
    validateBudget(budget)
    // A budget measures spending: it only makes sense on an expense category.
    requireCategory((await validationContext(unit)).categories, budget.categoryId, 'expense')
    const before = await unit.db.budgets.get([budget.categoryId, budget.month])
    if (before !== undefined) {
      await unit.replace('budgets', before, budget)
    } else {
      await unit.create('budgets', budget)
    }
    return { categoryId: budget.categoryId, month: budget.month }
  })
}

export function removeBudget(
  context: StoreContext,
  categoryId: CategoryId,
  month: YearMonth,
  options?: CommandOptions,
) {
  return commit(context, 'budget.remove', options, { categoryId, month }, async (unit) => {
    const row = await unit.db.budgets.get([categoryId, parseInput(yearMonthSchema, month)])
    if (row === undefined) {
      return { removed: false }
    }
    await unit.remove('budgets', row)
    return { removed: true }
  })
}

// ── Goals ────────────────────────────────────────────────────────────────────────────────────

export function createGoal(context: StoreContext, input: NewGoal, options?: CommandOptions) {
  return commit(context, 'goal.create', options, input, async (unit) => {
    const goal = parseInput(goalSchema, { ...input, id: input.id ?? unit.newId(), archived: false })
    validateGoal(goal)
    await unit.create('goals', goal)
    return { goalId: goal.id }
  })
}

export function updateGoal(context: StoreContext, id: GoalId, edit: GoalEdit, options?: CommandOptions) {
  return commit(context, 'goal.update', options, { id, edit }, async (unit) => {
    const before = await found(unit.db.goals.get(id), 'La meta no existe.')
    const next = parseInput(goalSchema, { ...withoutMeta(before), ...edit, id: before.id })
    validateGoal(next)
    await unit.replace('goals', before, next)
    return { goalId: id }
  })
}

async function openGoal(unit: UnitOfWork, goalId: GoalId): Promise<void> {
  const goal = await found(unit.db.goals.get(goalId), 'La meta no existe.')
  if (goal.archived) {
    throw new DataError('conflict', 'La meta está archivada: no aparta dinero.')
  }
}

function positive(amount: number): void {
  if (amount <= 0) {
    throw new DataError('invalid_input', 'El monto debe ser mayor que cero.')
  }
}

export function reserveForGoal(context: StoreContext, rawInput: ReservationInput, options?: CommandOptions) {
  return commit(context, 'goal.reserve', options, rawInput, async (unit) => {
    const input = parseInput(reservationInputSchema, rawInput)
    positive(input.amount)
    notInFuture(input.date, unit.today, 'Una reserva')
    const reservation: GoalReservation = parseInput(reservationSchema, {
      id: input.id ?? unit.newId(),
      goalId: input.goalId,
      date: input.date,
      amount: input.amount,
      voided: false,
    })
    await openGoal(unit, reservation.goalId)
    await unit.create('reservations', reservation)
    return { reservationId: reservation.id }
  })
}

export function releaseFromGoal(context: StoreContext, rawInput: ReservationInput, options?: CommandOptions) {
  return commit(context, 'goal.release', options, rawInput, async (unit) => {
    const input = parseInput(reservationInputSchema, rawInput)
    positive(input.amount)
    notInFuture(input.date, unit.today, 'Una liberación')
    const release: GoalReservation = parseInput(reservationSchema, {
      id: input.id ?? unit.newId(),
      goalId: input.goalId,
      date: input.date,
      amount: negate(input.amount),
      voided: false,
    })
    await found(unit.db.goals.get(release.goalId), 'La meta no existe.')
    const reservations = await unit.db.reservations.where('goalId').equals(release.goalId).toArray()
    if (!canRelease(release.goalId, input.amount, reservations, release.date)) {
      throw new DataError('conflict', 'No hay tanto dinero reservado para esta meta en esa fecha.')
    }
    await unit.create('reservations', release)
    return { reservationId: release.id }
  })
}

export function voidReservation(context: StoreContext, id: ReservationId, options?: CommandOptions) {
  return commit(context, 'reservation.void', options, { id }, async (unit) => {
    const before = await found(unit.db.reservations.get(id), 'La reserva no existe.')
    if (!before.voided) {
      await unit.replace('reservations', before, { ...withoutMeta(before), voided: true }, 'void')
      // A release that was half of «turn the reserve into a transfer» is undone with its transfer.
      if (before.transferId !== undefined) {
        const transfer = await unit.db.transactions.get(before.transferId)
        if (transfer !== undefined && !transfer.voided) {
          await unit.replace('transactions', transfer, voidTransaction(withoutMeta(transfer) as Transaction), 'void')
        }
      }
    }
    return { reservationId: id }
  })
}

export function fulfilReservationCommand(context: StoreContext, rawInput: FulfilInput, options?: CommandOptions) {
  return commit(context, 'goal.fulfil', options, rawInput, async (unit) => {
    const input = parseInput(fulfilInputSchema, rawInput)
    const goalId = toId<'goal'>(input.goalId)
    await openGoal(unit, goalId)
    const { accounts } = await validationContext(unit)
    // The release of the reserve and the transfer are produced together and stored together.
    const { release, transfer } = fulfilReservation({
      goalId,
      amount: input.amount,
      date: input.date,
      reservationId: toId<'reservation'>(input.reservationId ?? unit.newId()),
      transactionId: toId<'transaction'>(input.transactionId ?? unit.newId()),
      fromAccountId: toId<'account'>(input.fromAccountId),
      toAccountId: toId<'account'>(input.toAccountId),
      reservations: await unit.db.reservations.where('goalId').equals(goalId).toArray(),
      accounts,
      today: unit.today,
    })
    // The release remembers its transfer: from now on the two can only be voided together.
    await unit.create('reservations', { ...release, transferId: transfer.id })
    await unit.create('transactions', transfer)
    return { reservationId: release.id, transactionId: transfer.id }
  })
}
