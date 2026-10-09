import { useRef, type KeyboardEvent, type ReactNode } from 'react'

import { segmentedTabId } from '@/lib/segmented-tabs/segmentedTabs'
import { cn } from '@/lib/utils'

export type SegmentedTab<T extends string> = { value: T; label: ReactNode }

type SegmentedTabsProps<T extends string> = {
  tabs: SegmentedTab<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  panelId: string
  // Locked: the selected pill still reads, nothing is clickable or in the Tab order.
  disabled?: boolean
}

const tabClasses =
  'inline-flex min-h-11 items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 ease-out motion-reduce:transition-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none md:min-h-0'
const activeClasses = 'bg-primary text-primary-foreground'
const ARROW_STEPS: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 }
const inactiveClasses = 'text-muted-foreground hover:bg-muted hover:text-foreground'
const lockedInactiveClasses = 'text-muted-foreground'

// Roving tabindex: only the selected tab is in the Tab order; Arrow Left/Right move and select.
// The caller renders the panel with `id={panelId}` and `role="tabpanel"`.
export const SegmentedTabs = <T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
  panelId,
  disabled = false,
}: SegmentedTabsProps<T>) => {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = ARROW_STEPS[event.key]

    if (step === undefined || disabled) return

    event.preventDefault()
    const next = (index + step + tabs.length) % tabs.length

    onChange(tabs[next].value)
    buttons.current[next]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className={cn(
        'inline-flex flex-wrap gap-1 rounded-lg border border-border p-1',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      {tabs.map((tab, index) => {
        const isSelected = tab.value === value
        let pillClasses: string

        if (isSelected) {
          pillClasses = activeClasses
        } else if (disabled) {
          pillClasses = lockedInactiveClasses
        } else {
          pillClasses = inactiveClasses
        }

        return (
          <button
            key={tab.value}
            id={segmentedTabId(panelId, tab.value)}
            ref={(element) => {
              buttons.current[index] = element
            }}
            type="button"
            role="tab"
            aria-selected={isSelected}
            aria-controls={panelId}
            disabled={disabled}
            tabIndex={isSelected && !disabled ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(tabClasses, pillClasses)}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
