import { useState } from 'react'
import type { ProfileSession } from '@/data'
import { Button } from '@/ui/Button'

interface LossScreenProps {
  readonly session: ProfileSession
  /** Called once the person decided to start over and the empty profile is ready. */
  readonly onResolved: () => void
  readonly onLeave: () => void
}

/**
 * Shown instead of a blank app when the database came back empty although this phone remembers
 * that it held records (ADR 0007). Nothing was prepared on top of the hole: the person decides.
 */
export function LossScreen({ session, onResolved, onLeave }: LossScreenProps) {
  const [working, setWorking] = useState(false)
  const records = session.loss?.records ?? 0
  const when = session.loss?.at.slice(0, 10).split('-').reverse().join('-') ?? ''

  const startOver = (): void => {
    setWorking(true)
    void session
      .startOver()
      .then(onResolved)
      .finally(() => setWorking(false))
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col justify-center gap-6 px-5 py-10">
      <p className="eyebrow text-danger">Atención</p>
      <h1 className="font-serif text-4xl leading-10 text-ink">Los datos de {session.profile.name} no están.</h1>
      <div className="flex flex-col gap-3 text-base leading-7 text-muted">
        <p>
          Este teléfono recuerda que el {when} había{' '}
          {records === 0 ? 'cambios guardados' : records === 1 ? '1 registro' : `${String(records)} registros`} en este
          perfil, pero ahora la base está vacía. Lo más probable es que el navegador la haya borrado.
        </p>
        <p>
          Si tienes un respaldo, no empieces de cero: la opción de restaurarlo todavía no está construida en esta
          versión, y empezar de cero no la reemplaza.
        </p>
      </div>
      <div className="flex flex-col gap-2.5">
        <Button variant="secondary" size="lg" block onClick={onLeave}>
          Volver sin cambiar nada
        </Button>
        <Button variant="danger" size="lg" block disabled={working} onClick={startOver}>
          Empezar de cero
        </Button>
      </div>
    </main>
  )
}
