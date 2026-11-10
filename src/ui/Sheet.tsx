import { X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import type { ReactNode } from 'react'
import { IconButton } from './Button'

interface SheetProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly title: string
  /** Read by screen readers right after the title. */
  readonly description?: string
  readonly children: ReactNode
  /** Stays at the bottom of the sheet, above the home indicator: the main action goes here. */
  readonly footer?: ReactNode
}

/**
 * A bottom sheet: the mobile answer to a modal. It rises from the bottom edge, where the thumb is,
 * never covers the whole screen, and closes with the cross, a tap outside or Escape. Its surface
 * is opaque: a sheet holds a form or a list, and nothing behind may show through it.
 * Built on Radix Dialog, which keeps the focus inside and gives it back when it closes.
 */
export function Sheet({ open, onOpenChange, title, description, children, footer }: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70 data-[state=closed]:animate-[fade-out_160ms_ease-in] data-[state=open]:animate-[fade-in_200ms_ease-out]" />
        <Dialog.Content
          {...(description === undefined ? { 'aria-describedby': undefined } : {})}
          className="fixed inset-x-0 bottom-0 z-50 bg-night mx-auto flex max-h-[calc(100dvh-env(safe-area-inset-top,0px)-12px)] w-full max-w-[520px] flex-col rounded-t-sheet border border-b-0 border-line-strong shadow-sheet outline-none data-[state=closed]:animate-[sheet-out_180ms_ease-in] data-[state=open]:animate-[sheet-in_320ms_cubic-bezier(0.32,0.72,0,1)]"
        >
          <div className="flex shrink-0 flex-col items-center px-2 pt-2">
            <span aria-hidden="true" className="h-1 w-9 rounded-full bg-line-strong" />
            <div className="flex w-full items-center justify-between pl-3">
              <Dialog.Title className="text-base font-semibold text-ink">{title}</Dialog.Title>
              <Dialog.Close asChild>
                <IconButton label="Cerrar">
                  <X size={20} aria-hidden="true" />
                </IconButton>
              </Dialog.Close>
            </div>
            {description !== undefined && (
              <Dialog.Description className="sr-only">{description}</Dialog.Description>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-3">{children}</div>
          {footer !== undefined && (
            <div className="shrink-0 border-t border-line px-5 pt-2.5 pb-[max(10px,env(safe-area-inset-bottom))]">
              {footer}
            </div>
          )}
          {footer === undefined && <div className="h-[env(safe-area-inset-bottom,0px)] shrink-0" />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
