import { ArrowRight, NotebookPen } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import {
  DataError,
  type NewTransaction,
  requestPersistence,
  useAccounts,
  useCategories,
  useProfileStore,
  useStoreQuery,
} from '@/data'
import { type AccountId, type CategoryId, DomainError, type LocalDate, formatCLP } from '@/domain'
import { FitAmount } from '@/ui/Amount'
import { Button } from '@/ui/Button'
import { DateField } from '@/ui/DateField'
import { Chip, Segmented } from '@/ui/Layout'
import { Sheet } from '@/ui/Sheet'
import { useToast } from '@/ui/Toast'
import { type KeypadKey, amountOf, keyFromKeyboard, pressKey } from './amount-entry'
import { categoriesByUse, defaultAccount, defaultDestination, usableAccounts } from './defaults'
import { Keypad } from './Keypad'

type Kind = 'expense' | 'income' | 'transfer'

const KINDS: readonly { value: Kind; label: string }[] = [
  { value: 'expense', label: 'Gasto' },
  { value: 'income', label: 'Ingreso' },
  { value: 'transfer', label: 'Transferencia' },
]

const SAVED: Readonly<Record<Kind, string>> = {
  expense: 'Gasto registrado',
  income: 'Ingreso registrado',
  transfer: 'Transferencia registrada',
}

interface QuickAddSheetProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly today: LocalDate
}

/** A new key for every form: sending the same form twice registers once. */
function newFormKey(): string {
  return crypto.randomUUID()
}

const selectClass =
  'min-h-11 w-full min-w-0 appearance-none truncate rounded-xl border border-line-strong bg-surface px-3 text-sm text-ink'

/**
 * The most important screen of the app: registering a movement in a few seconds. The amount is
 * typed first, on the app's own keypad; then one tap for the category and one to save.
 */
export function QuickAddSheet({ open, onOpenChange, today }: QuickAddSheetProps) {
  const store = useProfileStore()
  const toast = useToast()
  const accounts = useAccounts()
  const categories = useCategories()
  const history = useStoreQuery((reader) => reader.transactions())

  const [kind, setKind] = useState<Kind>('expense')
  const [digits, setDigits] = useState('')
  const [categoryId, setCategoryId] = useState<CategoryId | null>(null)
  const [chosenAccount, setChosenAccount] = useState<AccountId | null>(null)
  const [chosenDestination, setChosenDestination] = useState<AccountId | null>(null)
  const [date, setDate] = useState<LocalDate | null>(null)
  const [note, setNote] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const formKey = useRef(newFormKey())

  const choices = useMemo(() => usableAccounts(accounts ?? []), [accounts])
  const offered = useMemo(
    () => (kind === 'transfer' ? [] : categoriesByUse(categories ?? [], history ?? [], kind)),
    [categories, history, kind],
  )

  const accountId = chosenAccount ?? defaultAccount(accounts ?? [], history ?? [], kind) ?? null
  const destinationId =
    chosenDestination !== null && chosenDestination !== accountId
      ? chosenDestination
      : (defaultDestination(accounts ?? [], history ?? [], accountId ?? undefined) ?? null)
  const movementDate = date ?? today
  const amount = amountOf(digits)

  const complete =
    amount > 0 &&
    accountId !== null &&
    (kind === 'transfer' ? destinationId !== null && destinationId !== accountId : categoryId !== null)

  const reset = (): void => {
    setDigits('')
    setCategoryId(null)
    setChosenAccount(null)
    setChosenDestination(null)
    setDate(null)
    setNote('')
    setDetailsOpen(false)
    setProblem(null)
    formKey.current = newFormKey()
  }

  const changeKind = (next: Kind): void => {
    setKind(next)
    setCategoryId(null)
    setChosenAccount(null)
    setChosenDestination(null)
    setProblem(null)
  }

  const typeKey = (key: KeypadKey): void => {
    setDigits((current) => pressKey(current, key))
    setProblem(null)
  }

  const save = (): void => {
    if (!complete || saving || accountId === null) {
      return
    }
    const common = { date: movementDate, amount, ...(note.trim().length > 0 ? { note: note.trim() } : {}) }
    let movement: NewTransaction
    if (kind === 'transfer') {
      if (destinationId === null) {
        return
      }
      movement = { kind, ...common, fromAccountId: accountId, toAccountId: destinationId }
    } else {
      if (categoryId === null) {
        return
      }
      movement = { kind, ...common, accountId, categoryId }
    }

    setSaving(true)
    setProblem(null)
    store
      .recordTransaction(movement, { idempotencyKey: formKey.current })
      .then(({ transactionId }) => {
        onOpenChange(false)
        reset()
        toast.show({
          message: SAVED[kind],
          detail: formatCLP(amount),
          actionLabel: 'Deshacer',
          onAction: () => {
            void store.voidTransaction(transactionId).then(() => toast.show({ message: 'Movimiento anulado' }))
          },
        })
        // After the first thing stored, ask the browser to keep the data (ADR 0007).
        void store.deviceState().then(async (device) => {
          if (device.persistence === null) {
            await store.notePersistence(await requestPersistence())
          }
        })
      })
      .catch((error: unknown) => {
        setProblem(
          error instanceof DomainError || error instanceof DataError
            ? error.message
            : 'No se pudo guardar. Inténtalo de nuevo.',
        )
      })
      .finally(() => setSaving(false))
  }

  const dateField = (
    <DateField label="Fecha" value={movementDate} today={today} onChange={setDate} />
  )

  // What is still missing, said on the button itself: a greyed «Guardar» alone explains nothing.
  const missing =
    amount <= 0
      ? 'Escribe el monto'
      : accountId === null
        ? 'Elige la cuenta'
        : kind === 'transfer'
          ? destinationId === null || destinationId === accountId
            ? 'Elige la cuenta de destino'
            : null
          : categoryId === null
            ? 'Elige una categoría'
            : null

  const accountOptions = (exclude?: AccountId | null) =>
    choices
      .filter((account) => account.id !== exclude)
      .map((account) => (
        <option key={account.id} value={account.id}>
          {account.name}
        </option>
      ))

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          setProblem(null)
        }
      }}
      title="Nuevo movimiento"
      description="Escribe el monto, elige la categoría y guarda."
      footer={
        <Button
          block
          size="lg"
          className="[@media(max-height:640px)]:min-h-12"
          disabled={!complete || saving}
          onClick={save}
        >
          {saving ? 'Guardando…' : (missing ?? 'Guardar')}
        </Button>
      }
    >
      <div
        className="flex flex-col gap-2 outline-none"
        onKeyDown={(event) => {
          if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
            return
          }
          const key = keyFromKeyboard(event.key)
          if (key !== null) {
            event.preventDefault()
            typeKey(key)
          } else if (event.key === 'Enter') {
            event.preventDefault()
            save()
          }
        }}
      >
        <Segmented label="Tipo de movimiento" value={kind} options={KINDS} onChange={changeKind} />

        <output
          aria-label="Monto"
          aria-live="polite"
          className="flex min-h-11 items-center [--amount-max:3rem] [@media(max-height:640px)]:[--amount-max:2.25rem]"
        >
          <FitAmount
            value={amount}
            max="var(--amount-max)"
            align="center"
            placeholder={digits.length === 0}
            className="font-semibold"
          />
        </output>

        {kind !== 'transfer' && (
          // The right edge fades out: there are more categories than the ones in sight.
          <div
            role="group"
            aria-label="Categoría"
            className="-mx-5 flex gap-2 overflow-x-auto px-5 [mask-image:linear-gradient(to_right,black_calc(100%-36px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {offered.map((category) => (
              <Chip key={category.id} selected={category.id === categoryId} onClick={() => setCategoryId(category.id)}>
                {category.name}
              </Chip>
            ))}
          </div>
        )}

        {kind === 'transfer' && (
          // Side by side where the screen is short; one under the other, with their names whole,
          // where there is room.
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5 [@media(min-height:700px)]:grid-cols-[auto_1fr] [@media(min-height:700px)]:gap-x-3">
            <span aria-hidden="true" className="hidden text-[0.8125rem] text-muted [@media(min-height:700px)]:block">
              Desde
            </span>
            <select
              aria-label="Desde la cuenta"
              className={selectClass}
              value={accountId ?? ''}
              onChange={(event) => setChosenAccount(event.target.value as AccountId)}
            >
              {accountOptions()}
            </select>
            <ArrowRight size={16} aria-hidden="true" className="text-muted [@media(min-height:700px)]:hidden" />
            <span aria-hidden="true" className="hidden text-[0.8125rem] text-muted [@media(min-height:700px)]:block">
              Hacia
            </span>
            <select
              aria-label="Hacia la cuenta"
              className={selectClass}
              value={destinationId ?? ''}
              onChange={(event) => setChosenDestination(event.target.value as AccountId)}
            >
              {accountOptions(accountId)}
            </select>
          </div>
        )}

        <div className="flex items-center gap-1.5">
          {kind !== 'transfer' && (
            <select
              aria-label="Cuenta"
              className={`${selectClass} flex-1`}
              value={accountId ?? ''}
              onChange={(event) => setChosenAccount(event.target.value as AccountId)}
            >
              {accountOptions()}
            </select>
          )}
          {dateField}
          <button
            type="button"
            aria-label="Nota"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((current) => !current)}
            className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border px-3 text-sm ${
              detailsOpen || note.length > 0 ? 'border-accent text-ink' : 'border-line-strong text-muted'
            } ${kind === 'transfer' ? 'flex-1' : ''}`}
          >
            <NotebookPen size={16} aria-hidden="true" />
            {/* On a narrow phone the word gives its room to the name of the account. */}
            <span className={kind === 'transfer' ? '' : 'hidden min-[400px]:inline'}>Nota</span>
          </button>
        </div>

        {detailsOpen && (
          <input
            type="text"
            aria-label="Texto de la nota"
            className={selectClass}
            value={note}
            maxLength={120}
            placeholder="Nota (opcional)"
            onChange={(event) => setNote(event.target.value)}
          />
        )}

        {problem !== null && (
          <p role="alert" className="rounded-xl border border-danger/50 bg-danger/10 px-3 py-2 text-sm leading-5 text-ink">
            {problem}
          </p>
        )}

        <Keypad onKey={typeKey} />
      </div>
    </Sheet>
  )
}
