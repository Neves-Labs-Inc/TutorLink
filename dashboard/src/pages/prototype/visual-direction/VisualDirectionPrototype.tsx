// Plan: Two visual directions for the redesigned dashboard, switchable via `?variant=A|B`,
// `?theme=light|dark`, `?screen=list|calendar|tutor`, on the throwaway route `/prototype/visual-direction`.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PrototypeSwitcher } from '@/components/shared/PrototypeSwitcher'
import { VariantA } from './VariantA'
import { VariantB } from './VariantB'
import type { Screen, Theme } from './mockData'

const FONTS_LINK_ID = 'visual-direction-fonts'
const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Lato:wght@100;300;400;700;900&family=Inter:wght@300..800&display=swap'
const PHONE_FRAME_MIN_WIDTH = 640
const VARIANTS = [
  { id: 'A', label: 'Faithful pastel' },
  { id: 'B', label: 'Calm product' },
]
const SCREENS = [
  { id: 'list', label: 'list' },
  { id: 'calendar', label: 'calendar' },
  { id: 'tutor', label: 'tutor' },
]

function useIsWide() {
  const query = `(min-width: ${PHONE_FRAME_MIN_WIDTH}px)`
  const [isWide, setIsWide] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const handleChange = () => setIsWide(media.matches)
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [query])
  return isWide
}

export function VisualDirectionPrototype() {
  const [params] = useSearchParams()
  const isWide = useIsWide()
  const variant = params.get('variant') === 'B' ? 'B' : 'A'
  const theme: Theme = params.get('theme') === 'dark' ? 'dark' : 'light'
  const screenParam = params.get('screen')
  const screen: Screen = screenParam === 'calendar' || screenParam === 'tutor' ? screenParam : 'list'

  useEffect(() => {
    if (document.getElementById(FONTS_LINK_ID)) return
    const link = document.createElement('link')
    link.id = FONTS_LINK_ID
    link.rel = 'stylesheet'
    link.href = FONTS_HREF
    document.head.appendChild(link)
  }, [])

  const content = variant === 'B' ? <VariantB theme={theme} screen={screen} /> : <VariantA theme={theme} screen={screen} />

  return (
    <>
      {screen === 'tutor' && isWide ? (
        <div className="flex min-h-dvh items-center justify-center bg-neutral-300 p-6">
          <div
            className="overflow-y-auto rounded-[40px] border-8 border-neutral-800 bg-white shadow-2xl"
            style={{ width: 390, height: 844, transform: 'translateZ(0)' }}
          >
            {content}
          </div>
        </div>
      ) : (
        content
      )}
      <PrototypeSwitcher variants={VARIANTS} screens={SCREENS} />
    </>
  )
}
