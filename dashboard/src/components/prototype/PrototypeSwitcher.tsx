// PROTOTYPE ONLY. Floating variant switcher; never ships (hidden in production builds).
import { useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export type PrototypeSwitcherProps = {
  screenLabel: string
  variants: { key: string; name: string }[]
  current: string
  onChange: (variant: string) => void
}

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  )
}

const arrowClasses =
  'inline-flex size-8 items-center justify-center rounded-full hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white'

export const PrototypeSwitcher = ({ screenLabel, variants, current, onChange }: PrototypeSwitcherProps) => {
  const index = Math.max(
    0,
    variants.findIndex((variant) => variant.key === current),
  )
  const hasVariants = variants.length > 1

  const step = (delta: number) => {
    const next = (index + delta + variants.length) % variants.length
    onChange(variants[next].key)
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!hasVariants || isTypingTarget(event.target)) return
      if (event.key === 'ArrowLeft') step(-1)
      if (event.key === 'ArrowRight') step(1)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  })

  if (import.meta.env.PROD) return null

  const label = hasVariants
    ? `${variants[index].key} (${variants[index].name})`
    : 'one version'

  return (
    <div
      role="toolbar"
      aria-label="Prototype variant switcher"
      className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full bg-black px-2 py-1.5 font-mono text-xs text-white shadow-2xl ring-2 ring-yellow-300"
    >
      <span className="rounded-full bg-yellow-300 px-2 py-0.5 font-semibold text-black">PROTOTYPE</span>
      {hasVariants && (
        <button type="button" aria-label="Previous variant" className={arrowClasses} onClick={() => step(-1)}>
          <ChevronLeft className="size-4" />
        </button>
      )}
      <span className="px-1 whitespace-nowrap">
        {screenLabel} · {label}
      </span>
      {hasVariants && (
        <button type="button" aria-label="Next variant" className={arrowClasses} onClick={() => step(1)}>
          <ChevronRight className="size-4" />
        </button>
      )}
    </div>
  )
}
