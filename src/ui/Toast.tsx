import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

interface ToastContent {
  readonly message: string
  /** A second, short piece (an amount) that goes after the message, or under it, but never split. */
  readonly detail?: string
  /** For example «Deshacer». */
  readonly actionLabel?: string
  readonly onAction?: () => void
  readonly tone?: 'neutral' | 'error'
}

interface ToastApi {
  show(toast: ToastContent): void
  dismiss(): void
}

const ToastContext = createContext<ToastApi | null>(null)

/** Long enough to read the message and reach «Deshacer» with the thumb. */
const VISIBLE_MS = 6000

/**
 * One short confirmation at a time, just above the bottom bar. It never blocks anything: it goes
 * away by itself, and what it offers (undoing) is always optional.
 *
 * It sits above the bottom bar and BELOW the sheets: a confirmation that is still on screen when
 * the next sheet opens must never cover the keypad or the «Guardar» button of that sheet.
 */
export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toast, setToast] = useState<(ToastContent & { readonly id: number }) | null>(null)
  const counter = useRef(0)

  const dismiss = useCallback(() => setToast(null), [])
  const show = useCallback((content: ToastContent) => {
    counter.current += 1
    setToast({ ...content, id: counter.current })
  }, [])

  useEffect(() => {
    if (toast === null) {
      return
    }
    const timer = window.setTimeout(dismiss, VISIBLE_MS)
    return () => window.clearTimeout(timer)
  }, [toast, dismiss])

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss])

  return (
    <ToastContext value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--nav-height)+12px)] z-[35] flex justify-center px-4"
      >
        {toast !== null && (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex min-h-12 w-full max-w-[488px] animate-[rise-in_220ms_ease-out] items-center justify-between gap-3 rounded-xl border bg-raised py-1.5 pr-1.5 pl-4 shadow-[0_12px_32px_rgb(0_0_0/0.5)] ${
              toast.tone === 'error' ? 'border-danger/60' : 'border-line-strong'
            }`}
          >
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm text-ink">
              <span>{toast.message}</span>
              {toast.detail !== undefined && <span className="money font-semibold">{toast.detail}</span>}
            </span>
            {toast.actionLabel !== undefined && (
              <button
                type="button"
                className="min-h-11 shrink-0 rounded-[10px] px-3 text-sm font-semibold text-amber active:bg-surface"
                onClick={() => {
                  toast.onAction?.()
                  dismiss()
                }}
              >
                {toast.actionLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext>
  )
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (api === null) {
    throw new Error('Falta <ToastProvider>')
  }
  return api
}
