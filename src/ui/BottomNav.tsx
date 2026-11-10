import { ChartNoAxesColumn, House, ListOrdered, Plus, Target } from 'lucide-react'
import type { ReactNode } from 'react'
import { NavLink } from 'react-router'

interface Destination {
  readonly to: string
  readonly label: string
  readonly icon: ReactNode
}

const BEFORE: readonly Destination[] = [
  { to: '/', label: 'Inicio', icon: <House size={22} aria-hidden="true" /> },
  { to: '/movimientos', label: 'Movimientos', icon: <ListOrdered size={22} aria-hidden="true" /> },
]

const AFTER: readonly Destination[] = [
  { to: '/metas', label: 'Metas', icon: <Target size={22} aria-hidden="true" /> },
  { to: '/analisis', label: 'Análisis', icon: <ChartNoAxesColumn size={22} aria-hidden="true" /> },
]

function Item({ to, label, icon }: Destination) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[0.6875rem] font-medium tracking-wide transition-colors duration-150 ${
          isActive ? 'text-ink' : 'text-muted active:text-ink'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-150 ${
              isActive ? 'bg-accent/20 text-accent' : ''
            }`}
          >
            {icon}
          </span>
          <span>{label}</span>
        </>
      )}
    </NavLink>
  )
}

/**
 * The bottom bar: five positions, with «Añadir» in the middle and larger than the rest, right
 * where the thumb rests. No position is spent on settings.
 */
export function BottomNav({ onAdd }: { readonly onAdd: () => void }) {
  return (
    <nav
      aria-label="Principal"
      className="bar fixed inset-x-0 bottom-0 z-30 border-t border-line pb-[env(safe-area-inset-bottom,0px)]"
    >
      <div className="mx-auto flex h-16 max-w-[520px] items-center px-1.5">
        {BEFORE.map((destination) => (
          <Item key={destination.to} {...destination} />
        ))}
        <div className="flex flex-1 items-center justify-center">
          <button
            type="button"
            onClick={onAdd}
            aria-label="Añadir movimiento"
            className="flex size-14 -translate-y-2.5 items-center justify-center rounded-full bg-accent text-obsidian shadow-[0_8px_24px_rgb(135_121_218/0.45)] ring-4 ring-obsidian transition-transform duration-150 active:scale-95"
          >
            <Plus size={28} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </div>
        {AFTER.map((destination) => (
          <Item key={destination.to} {...destination} />
        ))}
      </div>
    </nav>
  )
}
