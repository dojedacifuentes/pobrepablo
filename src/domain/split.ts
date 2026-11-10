import { invariant } from './errors'
import { compareIds } from './ids'
import { type Money, money } from './money'

/** A participant and their weight: any non-negative whole number (parts, or basis points). */
export interface Share<P extends string = string> {
  readonly participantId: P
  readonly weight: number
}

export interface Allocation<P extends string = string> {
  readonly participantId: P
  readonly amount: Money
}

export const BASIS_POINTS = 10_000

/**
 * Splits `total` in proportion to the weights with the largest-remainder method.
 *
 * - The parts always add up to exactly `total`.
 * - Nobody gets more than one peso away from their exact share.
 * - Ties for the leftover pesos go to the smaller participant id, so the result does not depend on
 *   the order in which participants are listed.
 * - A negative total (a refund) is split as the mirror image of the positive one.
 */
export function allocate<P extends string>(total: Money, shares: readonly Share<P>[]): Allocation<P>[] {
  invariant(shares.length > 0, 'El reparto necesita al menos un participante')

  const seen = new Set<string>()
  let totalWeight = 0n
  for (const share of shares) {
    invariant(
      Number.isSafeInteger(share.weight) && share.weight >= 0,
      `Peso de reparto inválido: ${String(share.weight)}`,
    )
    invariant(!seen.has(share.participantId), `Participante repetido en el reparto: ${share.participantId}`)
    seen.add(share.participantId)
    totalWeight += BigInt(share.weight)
  }
  invariant(totalWeight > 0n, 'La suma de los pesos del reparto debe ser mayor que cero')

  const sign = total < 0 ? -1 : 1
  const magnitude = BigInt(Math.abs(total))

  const rows = shares.map((share) => {
    const product = magnitude * BigInt(share.weight)
    return {
      participantId: share.participantId,
      base: product / totalWeight,
      remainder: product % totalWeight,
    }
  })

  let leftover = magnitude
  for (const row of rows) {
    leftover -= row.base
  }

  const byLargestRemainder = rows.toSorted((a, b) => {
    if (a.remainder !== b.remainder) {
      return a.remainder > b.remainder ? -1 : 1
    }
    return compareIds(a.participantId, b.participantId)
  })

  const receivesExtraPeso = new Set<string>()
  for (const row of byLargestRemainder) {
    if (leftover === 0n) {
      break
    }
    receivesExtraPeso.add(row.participantId)
    leftover -= 1n
  }

  return rows.map((row) => ({
    participantId: row.participantId,
    amount: money(sign * (Number(row.base) + (receivesExtraPeso.has(row.participantId) ? 1 : 0))),
  }))
}

export function equalShares<P extends string>(participantIds: readonly P[]): Share<P>[] {
  return participantIds.map((participantId) => ({ participantId, weight: 1 }))
}

/** Percentages expressed in basis points (50 % = 5000). They must add up to exactly 100 %. */
export function percentShares<P extends string>(
  entries: readonly { readonly participantId: P; readonly basisPoints: number }[],
): Share<P>[] {
  const total = entries.reduce((accumulated, entry) => accumulated + entry.basisPoints, 0)
  invariant(total === BASIS_POINTS, `Los porcentajes deben sumar 100 %: suman ${String(total / 100)} %`)
  return entries.map((entry) => ({ participantId: entry.participantId, weight: entry.basisPoints }))
}

/** Splits an amount into `parts` consecutive pieces; the first pieces carry the leftover pesos. */
export function splitEvenly(total: Money, parts: number): Money[] {
  invariant(Number.isInteger(parts) && parts >= 1 && parts <= 999, `Cantidad de partes inválida: ${String(parts)}`)
  const shares = Array.from({ length: parts }, (_, index) => ({
    participantId: String(index).padStart(3, '0'),
    weight: 1,
  }))
  return allocate(total, shares).map((allocation) => allocation.amount)
}
