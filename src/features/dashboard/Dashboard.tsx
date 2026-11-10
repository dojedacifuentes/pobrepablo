import { CircleHelp } from 'lucide-react'
import { useState } from 'react'
import { useAccounts, useCategories, useFinancialSnapshot, useStoreQuery } from '@/data'
import type { BudgetStatus, FinancialSnapshot, LocalDate, Obligation } from '@/domain'
import { Amount, FitAmount } from '@/ui/Amount'
import { Button } from '@/ui/Button'
import { dueLabel, shortDate } from '@/ui/dates'
import { Card, EmptyState, ProgressBar, Section } from '@/ui/Layout'
import { MovementRow } from '../shared/MovementRow'
import { type Names, namesOf } from '../shared/movements'
import { HowItIsCalculated } from './HowItIsCalculated'

interface DashboardProps {
  readonly today: LocalDate
  readonly onAddAccount: () => void
  readonly onAddMovement: () => void
}

const UPCOMING_SHOWN = 4
const RECENT_SHOWN = 5

function Hero({ snapshot, onExplain }: { readonly snapshot: FinancialSnapshot; readonly onExplain: () => void }) {
  const { available } = snapshot.available
  const short = available < 0
  return (
    <section
      aria-labelledby="disponible"
      className="glass relative overflow-hidden rounded-[20px] border border-line-strong px-5 pt-5 pb-3"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-16 -right-10 size-44 rounded-full bg-accent/25 blur-3xl"
      />
      <h2 id="disponible" className="eyebrow">
        Disponible para gastar
      </h2>
      <p className="mt-1.5">
        <FitAmount value={available} tone={short ? 'danger' : 'ink'} max="3.25rem" className="font-semibold" />
      </p>
      <p className="mt-1 text-[0.8125rem] leading-5 text-muted [text-wrap:balance]">
        {short
          ? 'Lo que tienes no alcanza para lo comprometido y lo apartado.'
          : 'Ya descontado lo comprometido y lo apartado.'}
      </p>
      <button
        type="button"
        onClick={onExplain}
        className="-ml-2 mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-[10px] px-2 text-sm font-medium text-accent active:bg-surface"
      >
        <CircleHelp size={16} aria-hidden="true" />
        ¿Cómo se calcula?
      </button>
    </section>
  )
}

function Summary({ snapshot }: { readonly snapshot: FinancialSnapshot }) {
  const cells = [
    { label: 'Ingresos del mes', value: snapshot.totals.income, tone: 'positive' as const },
    { label: 'Gastos del mes', value: snapshot.totals.expense, tone: 'ink' as const },
    { label: 'Por pagar', value: snapshot.obligationsTotal, tone: 'amber' as const },
    { label: 'Apartado', value: snapshot.reservedTotal, tone: 'ink' as const },
  ]
  return (
    <dl className="grid grid-cols-2 gap-2.5">
      {cells.map((cell) => (
        <div key={cell.label} className="flex min-w-0 flex-col gap-1 rounded-card border border-line bg-surface px-3.5 py-3">
          <dt className="text-[0.8125rem] text-muted">{cell.label}</dt>
          <dd className="min-w-0">
            <FitAmount value={cell.value} tone={cell.tone} max="1.125rem" className="font-semibold" />
          </dd>
        </div>
      ))}
    </dl>
  )
}

function obligationTitle(obligation: Obligation): string {
  switch (obligation.source) {
    case 'scheduled':
      return obligation.label
    case 'card':
      return `Cuota · ${obligation.label}`
    case 'household':
      return 'Lo que debes al hogar'
  }
}

function Upcoming({ obligations, today }: { readonly obligations: readonly Obligation[]; readonly today: LocalDate }) {
  const sorted = obligations.toSorted((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))
  const shown = sorted.slice(0, UPCOMING_SHOWN)
  const hidden = sorted.length - shown.length
  return (
    <Section title="Próximos compromisos">
      {shown.length === 0 ? (
        <p className="text-sm leading-6 text-muted">No hay nada por pagar en lo que queda del mes.</p>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {shown.map((obligation) => {
              const overdue = obligation.dueDate < today
              return (
                <li key={`${obligation.source}:${obligation.ref}`} className="flex min-h-14 items-center gap-3 px-3.5 py-2">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[0.9375rem] font-medium text-ink">{obligationTitle(obligation)}</span>
                    <span className={`text-[0.8125rem] ${overdue ? 'text-danger' : 'text-muted'}`}>
                      {obligation.source === 'household'
                        ? 'Pendiente de reembolso'
                        : `${overdue ? 'Venció' : 'Vence'} ${dueLabel(obligation.dueDate, today)} · ${shortDate(obligation.dueDate)}`}
                      {obligation.certainty === 'estimated' ? ' · estimado' : ''}
                    </span>
                  </span>
                  <Amount value={obligation.amount} className="shrink-0 text-[0.9375rem] font-semibold" />
                </li>
              )
            })}
          </ul>
          {hidden > 0 && (
            <p className="border-t border-line px-3.5 py-2.5 text-[0.8125rem] text-muted">
              Y {hidden === 1 ? '1 compromiso más' : `${String(hidden)} compromisos más`} este mes.
            </p>
          )}
        </Card>
      )}
    </Section>
  )
}

const BUDGET_WORDS: Readonly<Record<BudgetStatus['state'], { text: string; tone: 'positive' | 'amber' | 'danger' }>> = {
  ok: { text: 'Vas bien', tone: 'positive' },
  near: { text: 'Cerca del límite', tone: 'amber' },
  exceeded: { text: 'Excedido', tone: 'danger' },
}

function Budgets({ budgets, names }: { readonly budgets: readonly BudgetStatus[]; readonly names: Names }) {
  if (budgets.length === 0) {
    return null
  }
  return (
    <Section title="Presupuestos del mes">
      <Card className="flex flex-col divide-y divide-line">
        {budgets.map((budget) => {
          const words = BUDGET_WORDS[budget.state]
          return (
            <div key={budget.categoryId} className="flex flex-col gap-2 px-3.5 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-[0.9375rem] font-medium text-ink">
                  {names.categories.get(budget.categoryId) ?? 'Categoría'}
                </span>
                <span
                  className={`shrink-0 text-[0.8125rem] font-medium ${
                    words.tone === 'positive' ? 'text-positive' : words.tone === 'amber' ? 'text-amber' : 'text-danger'
                  }`}
                >
                  {words.text}
                </span>
              </div>
              <ProgressBar percent={budget.percentUsed ?? 0} tone={words.tone} />
              <p className="text-[0.8125rem] text-muted">
                <Amount value={budget.spent} tone="muted" /> de <Amount value={budget.planned} tone="muted" />
                {budget.percentUsed !== null ? ` · ${String(budget.percentUsed)} %` : ''}
              </p>
            </div>
          )
        })}
      </Card>
    </Section>
  )
}

/**
 * The home screen: one column, the figure that matters first. Every amount on it comes from
 * `financialSnapshot`, computed by the domain from what is stored on this phone.
 */
export function Dashboard({ today, onAddAccount, onAddMovement }: DashboardProps) {
  const snapshot = useFinancialSnapshot(today)
  const accounts = useAccounts()
  const categories = useCategories()
  // Newest first, and only what counts: voided movements stay in «Movimientos», not here.
  const recent = useStoreQuery(
    async (reader) =>
      (await reader.transactions({ to: today }))
        .filter((transaction) => !transaction.voided)
        .reverse()
        .slice(0, RECENT_SHOWN),
    [today],
  )
  const [explaining, setExplaining] = useState(false)

  if (snapshot === undefined || accounts === undefined || categories === undefined || recent === undefined) {
    return (
      <div aria-busy="true" className="flex flex-col gap-5">
        <div className="h-[164px] animate-pulse rounded-[20px] bg-surface" />
        <div className="grid grid-cols-2 gap-2.5">
          <div className="h-[72px] animate-pulse rounded-card bg-surface" />
          <div className="h-[72px] animate-pulse rounded-card bg-surface" />
        </div>
        <span className="sr-only">Cargando tus datos…</span>
      </div>
    )
  }

  if (accounts.length === 0) {
    return (
      <EmptyState
        title="Todavía no hay nada que contar."
        action={
          <Button size="lg" onClick={onAddAccount}>
            Crear mi primera cuenta
          </Button>
        }
      >
        Empieza por una cuenta y lo que tiene hoy: la corriente, el efectivo o la tarjeta. Desde ese saldo NEXO
        calcula todo lo demás. No hace falta inventar ninguna cifra.
      </EmptyState>
    )
  }

  const names = namesOf(accounts, categories)

  return (
    <div className="flex flex-col gap-6">
      <Hero snapshot={snapshot} onExplain={() => setExplaining(true)} />
      <Summary snapshot={snapshot} />
      <Upcoming obligations={snapshot.obligations} today={today} />
      <Budgets budgets={snapshot.budgets} names={names} />
      <Section title="Últimos movimientos">
        {recent.length === 0 ? (
          <EmptyState
            title="Aún no registras movimientos."
            action={
              <Button variant="secondary" onClick={onAddMovement}>
                Registrar el primero
              </Button>
            }
          >
            Anota un gasto o un ingreso con el botón + y aparecerá aquí al instante.
          </EmptyState>
        ) : (
          <Card>
            <ul className="divide-y divide-line">
              {recent.map((transaction) => (
                <MovementRow key={transaction.id} transaction={transaction} names={names} />
              ))}
            </ul>
          </Card>
        )}
      </Section>
      <HowItIsCalculated open={explaining} onOpenChange={setExplaining} available={snapshot.available} />
    </div>
  )
}
