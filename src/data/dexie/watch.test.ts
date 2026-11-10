import { describe, expect, it } from 'vitest'
import { financialSnapshot } from '@/domain'
import { cat, clp, d } from '@/domain/testing/builders'
import { toSnapshotInput } from '../ports'
import { testPhone } from '../testing/harness'

/** Waits until `values` holds at least `count` deliveries. */
async function until(values: unknown[], count: number): Promise<void> {
  for (let attempt = 0; attempt < 200 && values.length < count; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  if (values.length < count) {
    throw new Error(`Se esperaban ${String(count)} entregas y llegaron ${String(values.length)}`)
  }
}

describe('consultas reactivas: la base de datos es el estado', () => {
  it('al guardar un movimiento, quien observa recibe los datos nuevos sin pedirlos', async () => {
    const session = await testPhone('2026-11-10').open('pablo')
    const { store } = session
    const { accountId } = await store.createAccount({
      name: 'Cuenta de prueba',
      kind: 'checking',
      openingBalance: clp(100_000),
      openingDate: d('2026-11-01'),
    })

    const seen: number[] = []
    const subscription = store
      .watch(async (reader) => financialSnapshot(toSnapshotInput(await reader.ledger(), d('2026-11-10'))).liquidBalance)
      .subscribe((balance) => seen.push(balance))
    await until(seen, 1)
    expect(seen).toEqual([100_000])

    const { transactionId } = await store.recordTransaction({
      kind: 'expense',
      date: d('2026-11-09'),
      amount: clp(30_000),
      accountId,
      categoryId: cat('supermercado'),
    })
    await until(seen, 2)
    expect(seen.at(-1)).toBe(70_000)

    await store.voidTransaction(transactionId)
    await until(seen, 3)
    expect(seen.at(-1)).toBe(100_000)

    subscription.unsubscribe()
    const delivered = seen.length
    await store.recordTransaction({
      kind: 'expense',
      date: d('2026-11-09'),
      amount: clp(1),
      accountId,
      categoryId: cat('supermercado'),
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(seen.length).toBe(delivered)
  })

  it('una consulta que no depende de lo que cambió no se vuelve a entregar', async () => {
    const session = await testPhone().open('pablo')
    const categories: number[] = []
    const subscription = session.store
      .watch(async (reader) => (await reader.categories()).length)
      .subscribe((count) => categories.push(count))
    await until(categories, 1)

    await session.store.createGoal({ name: 'Meta de prueba', target: clp(1_000) })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(categories).toHaveLength(1)
    subscription.unsubscribe()
  })

  it('un error de la consulta llega a quien observa, explicado', async () => {
    const phone = testPhone()
    const session = await phone.open('pablo')
    await session.store.erase()
    const errors: unknown[] = []
    const subscription = session.store
      .watch((reader) => reader.profile())
      .subscribe(
        () => undefined,
        (error) => errors.push(error),
      )
    await until(errors, 1)
    expect(errors[0]).toMatchObject({ code: 'not_ready' })
    subscription.unsubscribe()
  })
})
