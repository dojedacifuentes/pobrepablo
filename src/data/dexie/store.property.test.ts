import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  type Account,
  type Transaction,
  applyTransaction,
  balancesFromHistory,
  equalShares,
  financialSnapshot,
  openingBalances,
  revertTransaction,
  toId,
} from '@/domain'
import { arbLedger } from '@/domain/testing/arbitraries'
import { DIEGO, MEMBERS, PABLO, cat, clp, d } from '@/domain/testing/builders'
import { type ProfileStore, toSnapshotInput } from '../ports'
import { databaseRuns, rawContent, testPhone } from '../testing/harness'

/** Later than any movement of the random histories, so that none of them is «in the future». */
const TODAY = '2026-12-31'

async function createAccounts(store: ProfileStore, accounts: readonly Account[]): Promise<void> {
  for (const account of accounts) {
    await store.createAccount({
      id: account.id,
      name: account.name,
      kind: account.kind,
      openingBalance: account.openingBalance,
      openingDate: account.openingDate,
      ...(account.paymentDay !== undefined ? { paymentDay: account.paymentDay } : {}),
      ...(account.statementDay !== undefined ? { statementDay: account.statementDay } : {}),
    })
    if (account.archived) {
      await store.updateAccount(account.id, { archived: true })
    }
  }
}

/** Registers one movement of a random history through the operation a person would use. */
async function register(store: ProfileStore, transaction: Transaction): Promise<void> {
  switch (transaction.kind) {
    case 'expense':
    case 'income':
    case 'transfer':
    case 'adjustment': {
      const draft: Record<string, unknown> = { ...transaction }
      delete draft.voided
      await store.recordTransaction(draft as never)
      if (transaction.voided) {
        await store.voidTransaction(transaction.id)
      }
      return
    }
    case 'shared_payment':
      await store.recordSharedExpense({
        id: transaction.sharedExpenseId,
        date: transaction.date,
        description: 'Gasto común de prueba',
        categoryId: cat('supermercado'),
        total: transaction.amount,
        payerId: PABLO,
        shares: equalShares(MEMBERS),
        payment: { accountId: transaction.accountId, transactionId: transaction.id },
      })
      if (transaction.voided) {
        await store.voidSharedExpense(transaction.sharedExpenseId)
      }
      return
    case 'settlement':
      await store.recordSettlement({
        id: transaction.settlementId,
        date: transaction.date,
        fromMemberId: transaction.direction === 'paid' ? PABLO : DIEGO,
        toMemberId: transaction.direction === 'paid' ? DIEGO : PABLO,
        amount: transaction.amount,
        movement: { accountId: transaction.accountId, transactionId: transaction.id },
      })
      if (transaction.voided) {
        await store.voidSettlement(transaction.settlementId)
      }
  }
}

describe('invariante: recalcular desde lo guardado da lo mismo que los saldos incrementales', () => {
  it(
    'registrando, corrigiendo, anulando, confirmando y cumpliendo reservas por las operaciones reales',
    { timeout: 300_000 },
    async () => {
      await fc.assert(
        fc.asyncProperty(
          arbLedger,
          fc.array(fc.option(fc.integer({ min: 100, max: 900_000 }), { nil: undefined }), { minLength: 30, maxLength: 30 }),
          async ({ accounts, transactions }, corrections) => {
            const phone = testPhone(TODAY)
            const session = await phone.open('pablo')
            const { store } = session
            await createAccounts(store, accounts)
            await store.createGoal({ id: toId('goal-a'), name: 'Meta de prueba A', target: clp(1_000_000) })
            await store.createGoal({ id: toId('goal-b'), name: 'Meta de prueba B', target: clp(1_000_000) })

            // The running balances, kept by hand while each movement is stored, corrected or voided.
            let incremental = openingBalances(accounts)
            const stored = async (id: string): Promise<Transaction> => {
              const found = (await store.transactions()).find((transaction) => transaction.id === id)
              if (found === undefined) {
                throw new Error(`no se guardó ${id}`)
              }
              return found
            }

            for (const [index, transaction] of transactions.entries()) {
              await register(store, transaction)
              let live: Transaction = { ...transaction, voided: false }
              incremental = applyTransaction(incremental, live)
              if (transaction.voided) {
                incremental = revertTransaction(incremental, live)
                continue
              }
              // Some movements are corrected afterwards: the old amount comes out, the new one goes in.
              const corrected = corrections[index]
              const editable =
                (transaction.kind === 'expense' || transaction.kind === 'transfer') ||
                (transaction.kind === 'income' && transaction.honorarium === undefined)
              if (corrected !== undefined && editable) {
                const draft: Record<string, unknown> = { ...transaction, amount: clp(corrected) }
                delete draft.id
                delete draft.voided
                await store.editTransaction(transaction.id, draft as never)
                incremental = revertTransaction(incremental, live)
                live = { ...live, amount: clp(corrected) }
                incremental = applyTransaction(incremental, live)
              }
            }

            // A programmed expense confirmed, and a reserve turned into a transfer: both are real
            // movements that the same balances must absorb.
            const cash = accounts.find((account) => account.kind === 'cash')
            const savings = accounts.find((account) => account.kind === 'savings')
            if (cash === undefined || savings === undefined) {
              throw new Error('faltan cuentas en el historial aleatorio')
            }
            const { ruleId } = await store.createRule({
              kind: 'expense',
              label: 'Arriendo de prueba',
              amount: clp(10_000),
              amountIsEstimate: false,
              accountId: cash.id,
              categoryId: cat('arriendo'),
              frequency: 'monthly',
              interval: 1,
              startDate: d('2026-12-01'),
            })
            const confirmation = await store.confirmOccurrence({
              ref: { ruleId, dueDate: d('2026-12-01') },
              date: d('2026-12-02'),
              amount: clp(12_345),
            })
            incremental = applyTransaction(incremental, await stored(confirmation.transactionId))

            await store.reserveForGoal({ goalId: toId('goal-a'), amount: clp(5_000), date: d('2026-12-01') })
            const fulfilment = await store.fulfilReservation({
              goalId: toId('goal-a'),
              amount: clp(5_000),
              date: d('2026-12-03'),
              fromAccountId: cash.id,
              toAccountId: savings.id,
            })
            const transfer = await stored(fulfilment.transactionId)
            incremental = applyTransaction(incremental, transfer)
            // …and undone again, together with its release.
            await store.voidReservation(fulfilment.reservationId)
            incremental = revertTransaction(incremental, transfer)

            const ledger = await store.ledger()
            expect(ledger.transactions).toHaveLength(transactions.length + 2)
            const recomputed = balancesFromHistory(ledger.accounts, ledger.transactions)
            expect(Object.fromEntries(recomputed)).toEqual(Object.fromEntries(incremental))
            // And what the dashboard would show comes from those very balances.
            const snapshot = financialSnapshot(toSnapshotInput(ledger, d(TODAY)))
            expect(Object.fromEntries(snapshot.balances)).toEqual(Object.fromEntries(incremental))
            // No household record was left without its counterpart along the way.
            expect(await store.ledgerIssues()).toEqual([])

            // Closing and opening the database again changes nothing.
            session.close()
            const reopened = await phone.open('pablo')
            const again = await reopened.store.ledger()
            expect(Object.fromEntries(balancesFromHistory(again.accounts, again.transactions))).toEqual(
              Object.fromEntries(incremental),
            )
            reopened.close()
          },
        ),
        { numRuns: databaseRuns() },
      )
    },
  )

  it(
    'el mismo historial, sin pasar por la base, da los mismos saldos',
    { timeout: 300_000 },
    async () => {
      await fc.assert(
        fc.asyncProperty(arbLedger, async ({ accounts, transactions }) => {
          const phone = testPhone(TODAY)
          const session = await phone.open('pablo')
          const { store } = session
          await createAccounts(store, accounts)
          await store.createGoal({ id: toId('goal-a'), name: 'Meta de prueba A', target: clp(1_000_000) })
          await store.createGoal({ id: toId('goal-b'), name: 'Meta de prueba B', target: clp(1_000_000) })
          for (const transaction of transactions) {
            await register(store, transaction)
          }
          const ledger = await store.ledger()
          expect(Object.fromEntries(balancesFromHistory(ledger.accounts, ledger.transactions))).toEqual(
            Object.fromEntries(balancesFromHistory(accounts, transactions)),
          )
          session.close()
        }),
        { numRuns: databaseRuns(4) },
      )
    },
  )
})

describe('invariante: una operación rechazada no deja nada a medias', () => {
  /**
   * Every way of failing leaves the database exactly as it was. The first four are refused before
   * anything is written. The last three fail after the first row was already written inside the
   * transaction, so they prove that the transaction is really rolled back.
   */
  const flaws = ['account', 'category', 'future', 'zero', 'second-row', 'guard', 'late-rule'] as const

  it(
    'la base queda byte a byte como estaba, falle antes o después de la primera escritura',
    { timeout: 300_000 },
    async () => {
      await fc.assert(
        fc.asyncProperty(arbLedger, fc.constantFrom(...flaws), async ({ accounts }, flaw) => {
          const phone = testPhone(TODAY)
          const session = await phone.open('pablo')
          const { store } = session
          await createAccounts(store, accounts)
          const checking = accounts.find((account) => account.kind === 'checking')?.id ?? toId<'account'>('x')
          const existing = await store.recordTransaction({
            id: toId('existente'),
            kind: 'expense',
            date: d('2026-06-10'),
            amount: clp(1_000),
            accountId: checking,
            categoryId: cat('supermercado'),
          })
          const paid = await store.recordSharedExpense({
            date: d('2026-06-12'),
            description: 'Gasto común de prueba',
            categoryId: cat('supermercado'),
            total: clp(30_000),
            payerId: PABLO,
            shares: equalShares(MEMBERS),
            payment: { accountId: checking },
          })
          const before = await rawContent(phone)

          const shared = (extra: object = {}) =>
            store.recordSharedExpense({
              date: d(flaw === 'future' ? '2027-01-01' : '2026-06-15'),
              description: 'Gasto común de prueba',
              categoryId: cat(flaw === 'category' ? 'sueldo' : 'supermercado'),
              total: clp(flaw === 'zero' ? 0 : 50_000),
              payerId: PABLO,
              shares: equalShares(MEMBERS),
              payment: { accountId: flaw === 'account' ? toId<'account'>('no-existe') : checking },
              ...extra,
            })

          let attempt: Promise<unknown>
          if (flaw === 'second-row') {
            // The shared expense is written, then its payment collides with an existing movement.
            attempt = shared({ payment: { accountId: checking, transactionId: existing.transactionId } })
          } else if (flaw === 'guard') {
            // The payment is voided, then the household check refuses the operation.
            attempt = store.voidTransaction(paid.transactionId ?? toId('x'))
          } else if (flaw === 'late-rule') {
            // The closed rule is written, then the new one collides with an existing rule.
            const { ruleId } = await store.createRule({
              id: toId('regla'),
              kind: 'expense',
              label: 'Arriendo de prueba',
              amount: clp(10_000),
              amountIsEstimate: false,
              accountId: checking,
              categoryId: cat('arriendo'),
              frequency: 'monthly',
              interval: 1,
              startDate: d('2026-06-05'),
            })
            const withRule = await rawContent(phone)
            await expect(
              store.rescheduleRule(ruleId, { lastDayOfOld: d('2026-08-31'), startDate: d('2026-09-10'), id: ruleId }),
            ).rejects.toThrow()
            expect(await rawContent(phone)).toStrictEqual(withRule)
            session.close()
            return
          } else {
            attempt = shared()
          }
          await expect(attempt).rejects.toThrow()

          expect(await rawContent(phone)).toStrictEqual(before)
          session.close()
        }),
        { numRuns: databaseRuns() },
      )
    },
  )
})
