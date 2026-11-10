import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DomainError } from './errors'
import { money, negate, sum } from './money'
import { type Share, allocate, equalShares, percentShares, splitEvenly } from './split'

const amounts = (total: number, shares: readonly Share[]) =>
  Object.fromEntries(allocate(money(total), shares).map((part) => [part.participantId, part.amount]))

describe('reparto por mayor resto', () => {
  it('reparte 50/50 y 70/30', () => {
    expect(amounts(200_000, equalShares(['diego', 'pablo']))).toEqual({ diego: 100_000, pablo: 100_000 })
    expect(
      amounts(
        200_000,
        percentShares([
          { participantId: 'diego', basisPoints: 7000 },
          { participantId: 'pablo', basisPoints: 3000 },
        ]),
      ),
    ).toEqual({ diego: 140_000, pablo: 60_000 })
  })

  it('el peso sobrante de un empate va al identificador menor, sin importar el orden de entrada', () => {
    expect(amounts(1001, equalShares(['pablo', 'diego']))).toEqual({ diego: 501, pablo: 500 })
    expect(amounts(1001, equalShares(['diego', 'pablo']))).toEqual({ diego: 501, pablo: 500 })
  })

  it('reparte los pesos sobrantes por mayor resto', () => {
    expect(amounts(100, equalShares(['a', 'b', 'c']))).toEqual({ a: 34, b: 33, c: 33 })
    expect(
      amounts(
        100,
        percentShares([
          { participantId: 'a', basisPoints: 3333 },
          { participantId: 'b', basisPoints: 3333 },
          { participantId: 'c', basisPoints: 3334 },
        ]),
      ),
    ).toEqual({ a: 33, b: 33, c: 34 })
  })

  it('quien tiene peso cero no recibe nada', () => {
    expect(
      amounts(999, [
        { participantId: 'a', weight: 0 },
        { participantId: 'b', weight: 1 },
        { participantId: 'c', weight: 1 },
      ]),
    ).toEqual({ a: 0, b: 500, c: 499 })
  })

  it('un total negativo es el espejo del positivo', () => {
    expect(amounts(-1001, equalShares(['diego', 'pablo']))).toEqual({ diego: -501, pablo: -500 })
  })

  it('rechaza repartos mal formados', () => {
    expect(() => allocate(money(100), [])).toThrow(DomainError)
    expect(() => allocate(money(100), equalShares(['a', 'a']))).toThrow(DomainError)
    expect(() => allocate(money(100), [{ participantId: 'a', weight: 0 }])).toThrow(DomainError)
    expect(() => allocate(money(100), [{ participantId: 'a', weight: -1 }])).toThrow(DomainError)
    expect(() => allocate(money(100), [{ participantId: 'a', weight: 0.5 }])).toThrow(DomainError)
    expect(() => percentShares([{ participantId: 'a', basisPoints: 9999 }])).toThrow(DomainError)
  })

  it('divide en cuotas iguales y deja los pesos sobrantes en las primeras', () => {
    expect(splitEvenly(money(100_000), 3)).toEqual([33_334, 33_333, 33_333])
    expect(splitEvenly(money(1000), 1)).toEqual([1000])
    expect(splitEvenly(money(2), 3)).toEqual([1, 1, 0])
  })
})

const arbShares = fc
  .array(fc.integer({ min: 0, max: 10_000 }), { minLength: 1, maxLength: 8 })
  .filter((weights) => weights.some((weight) => weight > 0))
  .map((weights) => weights.map((weight, index): Share => ({ participantId: `p${String(index)}`, weight })))

const arbTotal = fc.integer({ min: -2_000_000_000, max: 2_000_000_000 }).map(money)

describe('invariantes del reparto', () => {
  it('la suma de las partes es exactamente el total', () => {
    fc.assert(
      fc.property(arbTotal, arbShares, (total, shares) => {
        expect(sum(allocate(total, shares).map((part) => part.amount))).toBe(total)
      }),
    )
  })

  it('lo mismo con cualquier combinación de porcentajes que sume 100 %', () => {
    const arbPercents = fc
      .array(fc.integer({ min: 0, max: 10_000 }), { minLength: 1, maxLength: 6 })
      .map((cuts) => {
        const points = [0, ...cuts.toSorted((a, b) => a - b), 10_000]
        return points.slice(1).map((point, index) => ({
          participantId: `p${String(index)}`,
          basisPoints: point - (points[index] ?? 0),
        }))
      })
    fc.assert(
      fc.property(arbTotal, arbPercents, (total, percents) => {
        const parts = allocate(total, percentShares(percents))
        expect(sum(parts.map((part) => part.amount))).toBe(total)
      }),
    )
  })

  it('nadie queda a un peso o más de su parte exacta', () => {
    fc.assert(
      fc.property(arbTotal, arbShares, (total, shares) => {
        const totalWeight = shares.reduce((accumulated, share) => accumulated + BigInt(share.weight), 0n)
        for (const [index, part] of allocate(total, shares).entries()) {
          const weight = BigInt(shares[index]?.weight ?? 0)
          const distance = BigInt(part.amount) * totalWeight - BigInt(total) * weight
          expect(distance < totalWeight && distance > -totalWeight).toBe(true)
        }
      }),
    )
  })

  it('el resultado no depende del orden en que se listan los participantes', () => {
    fc.assert(
      fc.property(arbTotal, arbShares, (total, shares) => {
        const byId = (parts: readonly { participantId: string; amount: number }[]) =>
          parts.toSorted((a, b) => (a.participantId < b.participantId ? -1 : 1))
        expect(byId(allocate(total, shares.toReversed()))).toEqual(byId(allocate(total, shares)))
      }),
    )
  })

  it('repartir un total negativo es negar el reparto del positivo', () => {
    fc.assert(
      fc.property(arbTotal, arbShares, (total, shares) => {
        const positive = allocate(total, shares).map((part) => negate(part.amount))
        expect(allocate(negate(total), shares).map((part) => part.amount)).toEqual(positive)
      }),
    )
  })
})
