import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'lg' | 'md' | 'sm'

const VARIANTS: Readonly<Record<Variant, string>> = {
  // Dark text on the accent: light text on these colours does not reach AA (see tokens.test.ts).
  primary: 'bg-accent text-obsidian font-semibold active:brightness-90 disabled:bg-raised disabled:text-muted',
  secondary: 'bg-surface text-ink border border-line-strong font-medium active:bg-raised disabled:text-muted',
  ghost: 'bg-transparent text-ink font-medium active:bg-surface disabled:text-muted',
  danger: 'bg-transparent text-danger border border-danger/50 font-medium active:bg-danger/10',
}

/** Main controls are 48 to 56 px tall; nothing that can be tapped is shorter than 44 px. */
const SIZES: Readonly<Record<Size, string>> = {
  lg: 'min-h-14 px-5 text-base rounded-[14px]',
  md: 'min-h-12 px-4 text-[0.9375rem] rounded-xl',
  sm: 'min-h-11 px-3 text-sm rounded-[10px]',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: Variant
  readonly size?: Size
  readonly block?: boolean
  readonly children: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  className = '',
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 transition-[filter,background-color] duration-150 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** What the button does, for screen readers: an icon alone says nothing. */
  readonly label: string
  readonly children: ReactNode
}

/** A round 44 px button that shows only an icon. */
export function IconButton({ label, className = '', type = 'button', children, ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors duration-150 active:bg-surface ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
