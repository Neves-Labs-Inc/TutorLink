// PROTOTYPE — throwaway floating switcher for `?variant=` UI prototypes. Hidden in prod builds.
import { useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'

type PrototypeSwitcherProps = {
  variants: { key: string; name: string }[]
  current: string
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

export const PrototypeSwitcher = ({ variants, current }: PrototypeSwitcherProps) => {
  const [searchParams, setSearchParams] = useSearchParams()
  const index = Math.max(
    0,
    variants.findIndex((variant) => variant.key === current),
  )

  const go = (delta: number) => {
    const next = variants[(index + delta + variants.length) % variants.length]
    const params = new URLSearchParams(searchParams)
    params.set('variant', next.key)
    setSearchParams(params, { replace: true })
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return
      if (event.key === 'ArrowLeft') go(-1)
      if (event.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (import.meta.env.PROD) return null

  const variant = variants[index]

  return (
    <div className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-1 rounded-full bg-zinc-900 px-2 py-1.5 text-sm text-white shadow-lg ring-1 ring-white/20">
      <button
        type="button"
        aria-label="Previous variant"
        onClick={() => go(-1)}
        className="rounded-full p-1 hover:bg-white/15"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="px-2 font-medium whitespace-nowrap">
        {variant.key} <span className="text-white/70">({variant.name})</span>
      </span>
      <button
        type="button"
        aria-label="Next variant"
        onClick={() => go(1)}
        className="rounded-full p-1 hover:bg-white/15"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  )
}
