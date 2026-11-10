import { useRef, useState } from 'react'
import { DataError, type NewAccount, useProfileStore } from '@/data'
import { type AccountKind, DomainError, type LocalDate, ZERO, negate, parseCLP } from '@/domain'
import { Button } from '@/ui/Button'
import { Segmented } from '@/ui/Layout'
import { Sheet } from '@/ui/Sheet'
import { useToast } from '@/ui/Toast'

const KINDS: readonly { value: AccountKind; label: string }[] = [
  { value: 'checking', label: 'Cuenta' },
  { value: 'cash', label: 'Efectivo' },
  { value: 'savings', label: 'Ahorro' },
  { value: 'credit_card', label: 'Tarjeta' },
]

const SUGGESTED_NAME: Readonly<Record<AccountKind, string>> = {
  checking: 'Cuenta corriente',
  cash: 'Efectivo',
  savings: 'Cuenta de ahorro',
  credit_card: 'Tarjeta de crédito',
}

const fieldClass = 'min-h-12 w-full rounded-xl border border-line-strong bg-surface px-3.5 text-base text-ink'

interface FirstAccountSheetProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly today: LocalDate
}

/**
 * Creating an account with what it holds today. Everything the app computes starts from here:
 * the opening balance is what the person says it is, never a figure the app made up.
 */
export function FirstAccountSheet({ open, onOpenChange, today }: FirstAccountSheetProps) {
  const store = useProfileStore()
  const toast = useToast()
  const [kind, setKind] = useState<AccountKind>('checking')
  const [name, setName] = useState('')
  const [balanceText, setBalanceText] = useState('')
  const [paymentDayText, setPaymentDayText] = useState('')
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const formKey = useRef(crypto.randomUUID())

  const isCard = kind === 'credit_card'
  const typed = balanceText.trim().length === 0 ? ZERO : parseCLP(balanceText)
  const paymentDay = paymentDayText.trim().length === 0 ? undefined : Number(paymentDayText)
  const paymentDayValid =
    paymentDay === undefined || (Number.isInteger(paymentDay) && paymentDay >= 1 && paymentDay <= 31)
  const valid = typed !== null && (isCard ? typed >= 0 && paymentDayValid : true)

  const save = (): void => {
    if (typed === null || !valid || saving) {
      return
    }
    const account: NewAccount = {
      name: name.trim().length > 0 ? name.trim() : SUGGESTED_NAME[kind],
      kind,
      // What is owed on a card is typed as a positive figure and stored as the debt it is.
      openingBalance: isCard ? negate(typed) : typed,
      openingDate: today,
      ...(isCard && paymentDay !== undefined ? { paymentDay } : {}),
    }
    setSaving(true)
    setProblem(null)
    store
      .createAccount(account, { idempotencyKey: formKey.current })
      .then(() => {
        onOpenChange(false)
        toast.show({ message: `Cuenta creada: ${account.name}` })
        setName('')
        setBalanceText('')
        setPaymentDayText('')
        formKey.current = crypto.randomUUID()
      })
      .catch((error: unknown) => {
        setProblem(
          error instanceof DomainError || error instanceof DataError
            ? error.message
            : 'No se pudo crear la cuenta. Inténtalo de nuevo.',
        )
      })
      .finally(() => setSaving(false))
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Nueva cuenta"
      description="Indica qué cuenta es y cuánto tiene hoy."
      footer={
        <Button block size="lg" disabled={!valid || saving} onClick={save}>
          {saving ? 'Guardando…' : 'Crear cuenta'}
        </Button>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <Segmented label="Tipo de cuenta" value={kind} options={KINDS} onChange={setKind} />

        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">Nombre</span>
          <input
            type="text"
            className={fieldClass}
            value={name}
            maxLength={60}
            placeholder={SUGGESTED_NAME[kind]}
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">{isCard ? 'Cuánto debes hoy en la tarjeta' : 'Cuánto tiene hoy'}</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            className={`${fieldClass} money`}
            value={balanceText}
            placeholder="$0"
            aria-invalid={!valid && typed === null}
            onChange={(event) => setBalanceText(event.target.value)}
          />
          <span className="text-[0.8125rem] leading-5 text-muted">
            {typed === null
              ? 'Escribe solo pesos enteros, por ejemplo 250.000.'
              : isCard
                ? 'Si no debes nada, déjalo en cero.'
                : 'Es el punto de partida: lo anterior a hoy ya está incluido en este saldo.'}
          </span>
        </label>

        {isCard && (
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow">Día del mes en que la pagas (opcional)</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              className={fieldClass}
              value={paymentDayText}
              placeholder="Por ejemplo, 5"
              aria-invalid={!paymentDayValid}
              onChange={(event) => setPaymentDayText(event.target.value)}
            />
            {!paymentDayValid && <span className="text-[0.8125rem] text-danger">Debe ser un día entre 1 y 31.</span>}
          </label>
        )}

        {problem !== null && (
          <p role="alert" className="rounded-xl border border-danger/50 bg-danger/10 px-3 py-2 text-sm leading-5 text-ink">
            {problem}
          </p>
        )}
      </form>
    </Sheet>
  )
}
