import { EmptyState } from '@/ui/Layout'

/**
 * A section of the app that has not been built. It says so, and shows no figure at all: a screen
 * with invented numbers would look finished and would not be.
 */
export function NotBuiltYet({ title, children }: { readonly title: string; readonly children: string }) {
  return (
    <div className="flex flex-col gap-4">
      {/* The top bar already shows the name of the section. */}
      <h1 className="sr-only">{title}</h1>
      <EmptyState title="Esta sección todavía no está construida.">{children}</EmptyState>
    </div>
  )
}
