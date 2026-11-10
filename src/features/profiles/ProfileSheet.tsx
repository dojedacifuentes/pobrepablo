import { useState } from 'react'
import { resetDemo, useProfileSession } from '@/data'
import { Button } from '@/ui/Button'
import { Sheet } from '@/ui/Sheet'
import { useToast } from '@/ui/Toast'

interface ProfileSheetProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** Back to the list of profiles. */
  readonly onSwitch: () => void
}

/** Whose data is open, where it lives, and the way out to another profile. */
export function ProfileSheet({ open, onOpenChange, onSwitch }: ProfileSheetProps) {
  const session = useProfileSession()
  const toast = useToast()
  const [resetting, setResetting] = useState(false)
  // Resetting throws away whatever was tried in the Demo: the first tap only asks.
  const [confirming, setConfirming] = useState(false)
  const demo = session.profile.kind === 'demo'

  const reset = (): void => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    setResetting(true)
    void resetDemo(session)
      .then(() => {
        onOpenChange(false)
        toast.show({ message: 'La Demo volvió a su estado inicial' })
      })
      .catch(() => toast.show({ message: 'No se pudo reiniciar la Demo', tone: 'error' }))
      .finally(() => setResetting(false))
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        setConfirming(false)
      }}
      title={`Perfil: ${session.profile.name}`}
    >
      <div className="flex flex-col gap-4 pb-2">
        <div className="flex flex-col gap-2 text-sm leading-6 text-muted">
          {demo ? (
            <p>
              Este perfil trae finanzas inventadas para probar la app. Nada de lo que hagas aquí toca los perfiles de
              Pablo ni de Diego, y puedes dejarlo como al principio cuando quieras.
            </p>
          ) : (
            <p>
              Estos datos viven solo en este teléfono, dentro de esta app. No hay copia en la nube, y esta versión
              todavía no exporta respaldos.
            </p>
          )}
          <p>Los perfiles no tienen clave: quien tenga el teléfono puede abrir cualquiera.</p>
        </div>
        <div className="flex flex-col gap-2.5">
          <Button variant="secondary" size="lg" block onClick={onSwitch}>
            Cambiar de perfil
          </Button>
          {demo && (
            <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
              <p className="text-[0.8125rem] leading-5 text-muted">
                {confirming
                  ? 'Se perderá lo que hayas registrado en la Demo. Toca otra vez para confirmar.'
                  : 'Reiniciar deja la Demo como el primer día y borra lo que hayas probado en ella.'}
              </p>
              <Button variant="danger" size="md" block disabled={resetting} onClick={reset}>
                {resetting ? 'Reiniciando…' : confirming ? 'Sí, reiniciar la Demo' : 'Reiniciar la Demo'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  )
}
