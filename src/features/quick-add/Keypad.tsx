import { Delete } from 'lucide-react'
import type { KeypadKey } from './amount-entry'

const KEYS: readonly KeypadKey[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', 'backspace']

/**
 * The app's own numeric keypad. It is always there when the sheet opens, it never covers the form
 * the way a system keyboard does, and it has no decimal key: amounts are whole pesos.
 *
 * Its keys are 44 px tall on the shortest phone (320 × 568), the least a finger needs, and grow to
 * 48, 52 and 56 px as the screen gets taller.
 */
export function Keypad({ onKey }: { readonly onKey: (key: KeypadKey) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Teclado de montos">
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          aria-label={key === 'backspace' ? 'Borrar' : key === '000' ? 'Tres ceros' : key}
          onClick={() => onKey(key)}
          className="money flex h-11 items-center justify-center rounded-xl bg-raised text-[1.375rem] font-medium text-ink transition-colors duration-100 select-none active:bg-accent/30 [@media(min-height:640px)_and_(max-height:699px)]:h-12 [@media(min-height:700px)_and_(max-height:819px)]:h-13 [@media(min-height:820px)]:h-14"
        >
          {key === 'backspace' ? <Delete size={22} aria-hidden="true" /> : key}
        </button>
      ))}
    </div>
  )
}
