import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { type TransactionRecord, useAccounts, useCategories, useMonthActivity } from '@/data'
import { type LocalDate, type YearMonth, addMonths, yearMonthOf } from '@/domain'
import { IconButton } from '@/ui/Button'
import { dayTitle, monthTitle } from '@/ui/dates'
import { Card, EmptyState } from '@/ui/Layout'
import { MovementRow } from '../shared/MovementRow'
import { namesOf } from '../shared/movements'

/** Consecutive movements of the same day, kept in the order they came (newest first). */
function byDay(transactions: readonly TransactionRecord[]): { date: LocalDate; items: TransactionRecord[] }[] {
  const groups: { date: LocalDate; items: TransactionRecord[] }[] = []
  for (const transaction of transactions) {
    const last = groups.at(-1)
    if (last !== undefined && last.date === transaction.date) {
      last.items.push(transaction)
    } else {
      groups.push({ date: transaction.date, items: [transaction] })
    }
  }
  return groups
}

/**
 * The movements of one month, grouped by day, newest first. Voided ones stay in the list, crossed
 * out: nothing registered ever disappears. Search, filters and editing arrive in phase 5.
 */
export function ActivityScreen({ today }: { readonly today: LocalDate }) {
  const currentMonth = yearMonthOf(today)
  const [month, setMonth] = useState<YearMonth>(currentMonth)
  const transactions = useMonthActivity(month)
  const accounts = useAccounts()
  const categories = useCategories()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <IconButton label="Mes anterior" onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeft size={22} aria-hidden="true" />
        </IconButton>
        <h1 className="font-serif text-[1.75rem] leading-8 text-ink" aria-live="polite">
          {monthTitle(month)}
        </h1>
        <IconButton
          label="Mes siguiente"
          disabled={month >= currentMonth}
          className="disabled:opacity-30"
          onClick={() => setMonth(addMonths(month, 1))}
        >
          <ChevronRight size={22} aria-hidden="true" />
        </IconButton>
      </div>

      {transactions === undefined || accounts === undefined || categories === undefined ? (
        <div aria-busy="true" className="h-40 animate-pulse rounded-card bg-surface">
          <span className="sr-only">Cargando movimientos…</span>
        </div>
      ) : transactions.length === 0 ? (
        <EmptyState title="Sin movimientos este mes.">
          Lo que registres con el botón + aparecerá aquí, agrupado por día.
        </EmptyState>
      ) : (
        byDay(transactions).map((group) => (
          <section key={group.date} className="flex flex-col gap-2">
            <h2 className="eyebrow">{dayTitle(group.date, today)}</h2>
            <Card>
              <ul className="divide-y divide-line">
                {group.items.map((transaction) => (
                  <MovementRow key={transaction.id} transaction={transaction} names={namesOf(accounts, categories)} />
                ))}
              </ul>
            </Card>
          </section>
        ))
      )}
    </div>
  )
}
