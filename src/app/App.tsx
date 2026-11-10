import { Component, type ReactNode } from 'react'
import { BrowserRouter } from 'react-router'
import { DataError, ProfileProvider } from '@/data'
import { LossScreen } from '@/features/profiles/LossScreen'
import { ProfileGate } from '@/features/profiles/ProfileGate'
import { Button } from '@/ui/Button'
import { ToastProvider } from '@/ui/Toast'
import { AppShell } from './AppShell'
import { SessionProvider, useSessionControls } from './session'

/** What the person sees if reading the data fails: the reason, and a way to try again. */
class ReadErrorBoundary extends Component<{ readonly children: ReactNode }, { readonly message: string | null }> {
  override state = { message: null as string | null }

  static getDerivedStateFromError(error: unknown): { message: string } {
    return {
      message:
        error instanceof DataError ? error.message : 'Algo falló al leer tus datos. Tus datos no se modificaron.',
    }
  }

  override render(): ReactNode {
    if (this.state.message === null) {
      return this.props.children
    }
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col justify-center gap-5 px-5">
        <p className="eyebrow text-danger">No se pudo mostrar</p>
        <p className="font-serif text-3xl leading-9 text-ink">{this.state.message}</p>
        <Button size="lg" onClick={() => window.location.reload()}>
          Volver a intentar
        </Button>
      </main>
    )
  }
}

function Root() {
  const { state, choose, leave, refresh } = useSessionControls()

  switch (state.status) {
    case 'choosing':
      return <ProfileGate onChoose={choose} />
    case 'failed':
      return <ProfileGate onChoose={choose} failure={{ profileId: state.profileId, message: state.message }} />
    case 'opening':
      return (
        <main aria-busy="true" className="flex min-h-dvh items-center justify-center">
          <p className="font-serif text-3xl text-muted">Abriendo…</p>
        </main>
      )
    case 'open':
      if (state.session.loss !== null) {
        return <LossScreen session={state.session} onResolved={refresh} onLeave={leave} />
      }
      return (
        <ProfileProvider session={state.session}>
          <ReadErrorBoundary>
            <AppShell />
          </ReadErrorBoundary>
        </ProfileProvider>
      )
  }
}

export function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <ToastProvider>
          <Root />
        </ToastProvider>
      </SessionProvider>
    </BrowserRouter>
  )
}
