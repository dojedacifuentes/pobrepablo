import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { DataError, PROFILES, type ProfileId, type ProfileSession, openProfile } from '@/data'
import { environment } from './today'

/**
 * Which profile is open on this device. The choice is a trivial preference of the interface, so
 * it lives in `localStorage`; everything financial lives in the profile's own database.
 */
const ACTIVE_PROFILE_KEY = 'nexo.perfil'

function rememberedProfile(): ProfileId | null {
  try {
    const stored = window.localStorage.getItem(ACTIVE_PROFILE_KEY)
    return PROFILES.find((profile) => profile.id === stored)?.id ?? null
  } catch {
    return null
  }
}

function remember(id: ProfileId | null): void {
  try {
    if (id === null) {
      window.localStorage.removeItem(ACTIVE_PROFILE_KEY)
    } else {
      window.localStorage.setItem(ACTIVE_PROFILE_KEY, id)
    }
  } catch {
    // A blocked localStorage only means the app will ask again next time.
  }
}

export type SessionState =
  | { readonly status: 'choosing' }
  | { readonly status: 'opening'; readonly profileId: ProfileId }
  | { readonly status: 'open'; readonly session: ProfileSession }
  | { readonly status: 'failed'; readonly profileId: ProfileId; readonly message: string }

interface SessionControls {
  readonly state: SessionState
  /** Opens a profile and remembers it for next time. */
  readonly choose: (id: ProfileId) => void
  /** Back to the list of profiles. */
  readonly leave: () => void
  /** Tells the app that the session changed from inside (a loss was resolved). */
  readonly refresh: () => void
}

const ControlsContext = createContext<SessionControls | null>(null)

export function SessionProvider({ children }: { readonly children: ReactNode }) {
  const [profileId, setProfileId] = useState<ProfileId | null>(rememberedProfile)
  const [state, setState] = useState<SessionState>(() =>
    profileId === null ? { status: 'choosing' } : { status: 'opening', profileId },
  )
  const [, setVersion] = useState(0)

  useEffect(() => {
    if (profileId === null) {
      return
    }
    let cancelled = false
    let opened: ProfileSession | null = null
    openProfile(profileId, { env: environment })
      .then((session) => {
        if (cancelled) {
          session.close()
          return
        }
        opened = session
        setState({ status: 'open', session })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const message =
            error instanceof DataError ? error.message : 'No se pudieron abrir los datos de este perfil.'
          setState({ status: 'failed', profileId, message })
        }
      })
    return () => {
      cancelled = true
      opened?.close()
    }
  }, [profileId])

  const choose = useCallback((id: ProfileId) => {
    remember(id)
    setState({ status: 'opening', profileId: id })
    setProfileId(id)
  }, [])

  const leave = useCallback(() => {
    remember(null)
    setProfileId(null)
    setState({ status: 'choosing' })
  }, [])

  const refresh = useCallback(() => setVersion((version) => version + 1), [])

  const controls = useMemo(() => ({ state, choose, leave, refresh }), [state, choose, leave, refresh])
  return <ControlsContext value={controls}>{children}</ControlsContext>
}

export function useSessionControls(): SessionControls {
  const controls = useContext(ControlsContext)
  if (controls === null) {
    throw new Error('Falta <SessionProvider>')
  }
  return controls
}
