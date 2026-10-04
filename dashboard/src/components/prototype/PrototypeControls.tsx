// PROTOTYPE ONLY. Dashed box of state toggles for showing edge cases; not part of the design.
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export type PrototypeToggleOption<T extends string> = { value: T; label: string }

type PrototypeControlsProps = { children: ReactNode }

type PrototypeToggleProps<T extends string> = {
  label: string
  options: PrototypeToggleOption<T>[]
  value: T
  onChange: (value: T) => void
}

export const PrototypeControls = ({ children }: PrototypeControlsProps) => (
  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border-2 border-dashed border-muted-foreground/40 px-3 py-2 font-mono text-xs text-muted-foreground">
    <span className="font-semibold uppercase">Prototype controls</span>
    {children}
  </div>
)

export const PrototypeToggle = <T extends string>({
  label,
  options,
  value,
  onChange,
}: PrototypeToggleProps<T>) => (
  <div className="flex flex-wrap items-center gap-1.5">
    <span>{label}:</span>
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        aria-pressed={value === option.value}
        onClick={() => onChange(option.value)}
        className={cn(
          'rounded border border-dashed border-muted-foreground/40 px-1.5 py-0.5',
          value === option.value ? 'bg-foreground text-background' : 'hover:bg-muted',
        )}
      >
        {option.label}
      </button>
    ))}
  </div>
)
