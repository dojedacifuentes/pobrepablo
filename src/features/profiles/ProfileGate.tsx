import { ChevronRight, FlaskConical, User } from 'lucide-react'
import { PROFILES, type ProfileId } from '@/data'

interface ProfileGateProps {
  readonly onChoose: (id: ProfileId) => void
  /** The profile that could not be opened, with the reason, if that is why this screen shows. */
  readonly failure?: { readonly profileId: ProfileId; readonly message: string }
}

/**
 * The first screen: whose finances to open. It says plainly where the data lives and that the
 * profiles are not protected from each other. No password is asked, because none exists.
 */
export function ProfileGate({ onChoose, failure }: ProfileGateProps) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col justify-between gap-8 px-5 pt-[max(40px,env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))] [@media(max-height:640px)]:gap-5 [@media(max-height:640px)]:pt-[max(20px,env(safe-area-inset-top))] [@media(max-height:640px)]:pb-4">
      <header className="flex flex-col gap-3 [@media(max-height:640px)]:gap-1.5">
        <p className="eyebrow text-amber">Archivo 09.11</p>
        <h1 className="font-serif text-[3.25rem] leading-none tracking-tight text-ink [@media(max-height:640px)]:text-[2.5rem]">
          NEXO
        </h1>
        <p className="max-w-[30ch] text-base leading-6 text-muted [@media(max-height:640px)]:max-w-none [@media(max-height:640px)]:text-sm [@media(max-height:640px)]:leading-5">
          Tus finanzas, guardadas solo en este teléfono. ¿De quién son las cuentas que vamos a abrir?
        </p>
      </header>

      <div className="flex flex-col gap-3">
        {failure !== undefined && (
          <p role="alert" className="rounded-card border border-danger/50 bg-danger/10 px-4 py-3 text-sm leading-6 text-ink">
            {failure.message}
          </p>
        )}
        <ul className="flex flex-col gap-2.5">
          {PROFILES.map((profile) => {
            const demo = profile.kind === 'demo'
            return (
              <li key={profile.id}>
                <button
                  type="button"
                  onClick={() => onChoose(profile.id)}
                  className="flex min-h-[72px] w-full items-center gap-3.5 rounded-card border border-line-strong bg-surface px-4 py-3 text-left transition-colors duration-150 active:bg-raised [@media(max-height:640px)]:min-h-[60px]"
                >
                  <span
                    aria-hidden="true"
                    className={`flex size-11 shrink-0 items-center justify-center rounded-full ${
                      demo ? 'bg-amber/15 text-amber' : 'bg-accent/20 text-accent'
                    }`}
                  >
                    {demo ? <FlaskConical size={22} /> : <User size={22} />}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[1.0625rem] font-semibold text-ink">{profile.name}</span>
                    <span className="text-sm leading-5 text-muted">
                      {demo ? 'Datos inventados, para probar la app' : 'Perfil personal'}
                    </span>
                  </span>
                  <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-muted" />
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      <footer className="flex flex-col gap-2 text-[0.8125rem] leading-5 text-muted [@media(max-height:640px)]:gap-1 [@media(max-height:640px)]:text-xs [@media(max-height:640px)]:leading-[1.15rem]">
        <p>
          Los perfiles no tienen clave: cualquiera que tenga este teléfono puede abrir cualquiera de los tres.
        </p>
        <p>
          Nada sale de este teléfono y no hay copia en la nube.{' '}
          <span className="text-amber">
            La app está en construcción y todavía no exporta respaldos: por ahora conviene probarla con la Demo.
          </span>
        </p>
      </footer>
    </main>
  )
}
