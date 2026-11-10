import { useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import { useAccounts, useProfileSession, useProfileStore, useSettings } from '@/data'
import { yearMonthOf } from '@/domain'
import { FirstAccountSheet } from '@/features/accounts/FirstAccountSheet'
import { ActivityScreen } from '@/features/activity/ActivityScreen'
import { Dashboard } from '@/features/dashboard/Dashboard'
import { NotBuiltYet } from '@/features/pending/NotBuiltYet'
import { ProfileSheet } from '@/features/profiles/ProfileSheet'
import { QuickAddSheet } from '@/features/quick-add/QuickAddSheet'
import { HiddenAmountsProvider } from '@/ui/Amount'
import { AppHeader } from '@/ui/AppHeader'
import { BottomNav } from '@/ui/BottomNav'
import { monthTitle } from '@/ui/dates'
import { useSessionControls } from './session'
import { useToday } from './today'

/** What the top bar says on each screen. The home screen shows the month it is about. */
const SECTION_TITLES: Readonly<Record<string, string>> = {
  '/movimientos': 'Movimientos',
  '/metas': 'Metas',
  '/analisis': 'Análisis',
}

/** The setting that hides every amount. Stored with the profile, so it travels in its backups. */
const HIDE_AMOUNTS = 'montos-ocultos'

/** Everything around the screens: the top bar, the bottom bar and the sheets they open. */
export function AppShell() {
  const session = useProfileSession()
  const store = useProfileStore()
  const { leave } = useSessionControls()
  const today = useToday()
  const { pathname } = useLocation()
  const settings = useSettings()
  const accounts = useAccounts()
  const [adding, setAdding] = useState(false)
  const [creatingAccount, setCreatingAccount] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  const amountsHidden = settings?.[HIDE_AMOUNTS] === true
  // Nothing can be registered without an account to register it on: the first step comes first.
  const add = (): void => {
    if (accounts !== undefined && accounts.length === 0) {
      setCreatingAccount(true)
    } else {
      setAdding(true)
    }
  }

  return (
    <HiddenAmountsProvider value={amountsHidden}>
      <AppHeader
        title={SECTION_TITLES[pathname] ?? monthTitle(yearMonthOf(today))}
        profileName={session.profile.name}
        demo={session.profile.kind === 'demo'}
        amountsHidden={amountsHidden}
        onToggleAmounts={() => void store.setSetting(HIDE_AMOUNTS, !amountsHidden)}
        onOpenProfile={() => setProfileOpen(true)}
      />
      <main className="mx-auto w-full max-w-[520px] px-4 pt-4 pb-[calc(var(--nav-height)+28px)]">
        <Routes>
          <Route
            index
            element={<Dashboard today={today} onAddAccount={() => setCreatingAccount(true)} onAddMovement={add} />}
          />
          <Route path="movimientos" element={<ActivityScreen today={today} />} />
          <Route
            path="metas"
            element={
              <NotBuiltYet title="Metas">
                Aquí irán tus metas de ahorro: cuánto llevas, cuánto falta y cuánto conviene apartar cada mes.
              </NotBuiltYet>
            }
          />
          <Route
            path="analisis"
            element={
              <NotBuiltYet title="Análisis">
                Aquí irán los gráficos del mes, la comparación con meses anteriores y la proyección de tu saldo.
              </NotBuiltYet>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <BottomNav onAdd={add} />
      <QuickAddSheet open={adding} onOpenChange={setAdding} today={today} />
      <FirstAccountSheet open={creatingAccount} onOpenChange={setCreatingAccount} today={today} />
      <ProfileSheet
        open={profileOpen}
        onOpenChange={setProfileOpen}
        onSwitch={() => {
          setProfileOpen(false)
          leave()
        }}
      />
    </HiddenAmountsProvider>
  )
}
