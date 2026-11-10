import { ChevronDown, Eye, EyeOff } from 'lucide-react'
import { IconButton } from './Button'

interface AppHeaderProps {
  readonly title: string
  readonly profileName: string
  /** The Demo profile carries a permanent notice: its figures are invented. */
  readonly demo: boolean
  readonly amountsHidden: boolean
  readonly onToggleAmounts: () => void
  readonly onOpenProfile: () => void
}

/**
 * The top bar: whose finances these are, the month in view, and the switch that hides every
 * amount. Profile and settings live here, so that no position of the bottom bar is spent on them.
 */
export function AppHeader({
  title,
  profileName,
  demo,
  amountsHidden,
  onToggleAmounts,
  onOpenProfile,
}: AppHeaderProps) {
  return (
    <header className="bar sticky top-0 z-20 border-b border-line pt-[env(safe-area-inset-top,0px)]">
      <div className="mx-auto flex h-14 max-w-[520px] items-center justify-between gap-2 pr-1.5 pl-3">
        <button
          type="button"
          onClick={onOpenProfile}
          aria-label={`Perfil: ${profileName}. Cambiar de perfil`}
          className="flex min-h-11 min-w-0 items-center gap-2 rounded-full py-1 pr-2.5 pl-1 active:bg-surface"
        >
          <span
            aria-hidden="true"
            className={`flex size-9 shrink-0 items-center justify-center rounded-full text-[0.9375rem] font-semibold ${
              demo ? 'bg-amber/20 text-amber' : 'bg-accent/25 text-accent'
            }`}
          >
            {profileName.charAt(0).toUpperCase()}
          </span>
          <span className="flex min-w-0 flex-col items-start leading-tight">
            <span className="truncate text-[0.6875rem] font-medium tracking-wide text-muted">{profileName}</span>
            <span className="truncate text-[0.9375rem] font-semibold text-ink">{title}</span>
          </span>
          <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-muted" />
        </button>
        <IconButton
          label={amountsHidden ? 'Mostrar montos' : 'Ocultar montos'}
          aria-pressed={amountsHidden}
          onClick={onToggleAmounts}
        >
          {amountsHidden ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
        </IconButton>
      </div>
      {demo && (
        <p className="bg-amber px-3 py-1 text-center text-[0.6875rem] font-semibold tracking-[0.08em] text-obsidian uppercase">
          Demo · todas las cifras son inventadas
        </p>
      )}
    </header>
  )
}
