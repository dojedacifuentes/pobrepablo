import type { AvailableToSpend, ExplanationCode } from '@/domain'
import { Amount } from '@/ui/Amount'
import { Sheet } from '@/ui/Sheet'

const LINES: Readonly<Record<ExplanationCode, { title: string; detail: string }>> = {
  liquid_balance: {
    title: 'Lo que tienes hoy',
    detail: 'Efectivo y cuentas corrientes. El ahorro y las tarjetas no cuentan aquí.',
  },
  pending_obligations: {
    title: 'Lo que ya está comprometido',
    detail: 'Pagos programados del mes, cuotas de la tarjeta y lo que debes al hogar.',
  },
  reserved: {
    title: 'Lo que apartaste',
    detail: 'Reservas para metas y presupuestos con fondo que aún no gastas.',
  },
  available_to_spend: {
    title: 'Disponible para gastar',
    detail: 'Lo que queda después de restar lo comprometido y lo apartado.',
  },
}

interface HowItIsCalculatedProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly available: AvailableToSpend
}

/** «¿Cómo se calcula?»: the four lines of the domain, one by one. The first three add up to the last. */
export function HowItIsCalculated({ open, onOpenChange, available }: HowItIsCalculatedProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="¿Cómo se calcula?"
      description="Disponible para gastar, paso a paso."
    >
      <ol className="flex flex-col">
        {available.steps.map((step, index) => {
          const total = step.code === 'available_to_spend'
          return (
            <li
              key={step.code}
              className={`flex items-start justify-between gap-4 py-3.5 ${
                total ? 'mt-1 border-t border-line-strong' : index > 0 ? 'border-t border-line' : ''
              }`}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className={`text-[0.9375rem] ${total ? 'font-semibold text-ink' : 'font-medium text-ink'}`}>
                  {LINES[step.code].title}
                </span>
                <span className="text-[0.8125rem] leading-5 text-muted">{LINES[step.code].detail}</span>
              </span>
              <Amount
                value={step.amount}
                tone={total && step.amount < 0 ? 'danger' : 'ink'}
                className={`shrink-0 pt-0.5 ${total ? 'text-lg font-semibold' : 'text-[0.9375rem] font-medium'}`}
              />
            </li>
          )
        })}
      </ol>
      <p className="pb-2 text-[0.8125rem] leading-5 text-muted">
        Todo se recalcula desde tus movimientos cada vez que registras algo. Un pago programado de monto variable se
        cuenta por su monto estimado.
      </p>
    </Sheet>
  )
}
