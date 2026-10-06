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
}

const tabClasses =
  'inline-flex min-h-11 items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 ease-out motion-reduce:transition-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none md:min-h-0'
const activeClasses = 'bg-primary text-primary-foreground'
const ARROW_STEPS: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 }
const inactiveClasses = 'text-muted-foreground hover:bg-muted hover:text-foreground'

// Roving tabindex: only the selected tab is in the Tab order; Arrow Left/Right move and select.
// The caller renders the panel with `id={panelId}` and `role="tabpanel"`.
export const SegmentedTabs = <T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
  panelId,
}: SegmentedTabsProps<T>) => {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = ARROW_STEPS[event.key]

    if (step === undefined) return

    event.preventDefault()
    const next = (index + step + tabs.length) % tabs.length

    onChange(tabs[next].value)
    buttons.current[next]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex flex-wrap gap-1 rounded-lg border border-border p-1"
    >
      {tabs.map((tab, index) => {
        const isSelected = tab.value === value

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
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(tabClasses, isSelected ? activeClasses : inactiveClasses)}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
