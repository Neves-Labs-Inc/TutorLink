import { beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import { SlideOver } from '@/components/shared/SlideOver'
import { settleLayout } from '@/test/settleLayout'

const PHONE_WIDTH = 375
const PHONE_HEIGHT = 812
const DESKTOP_WIDTH = 1280
const DESKTOP_HEIGHT = 800
const MIN_TOUCH_TARGET_PX = 44
const DESKTOP_CLOSE_PX = 32
const GLYPH_PX = 16

function renderSlideOver() {
  return render(
    <SlideOver
      open
      onOpenChange={() => {}}
      title="Edit subject"
      description="Changes show on every tutor who teaches it."
    >
      <p>Body</p>
    </SlideOver>,
  )
}

const closeButton = () => page.getByRole('button', { name: 'Close' })

async function measureClose(): Promise<{ button: DOMRect; glyph: DOMRect; header: HTMLElement }> {
  await expect.element(closeButton()).toBeVisible()
  await settleLayout()
  const button = closeButton().element()
  const glyph = button.querySelector('svg')
  const header = button.parentElement

  if (!glyph || !header) throw new Error('Close button is missing its glyph or header')
  return {
    button: button.getBoundingClientRect(),
    glyph: glyph.getBoundingClientRect(),
    header,
  }
}

describe('SlideOver close button', () => {
  beforeEach(async () => {
    await page.viewport(DESKTOP_WIDTH, DESKTOP_HEIGHT)
  })

  it('is a 44px touch target with a 16px glyph at phone width, without header scroll', async () => {
    await page.viewport(PHONE_WIDTH, PHONE_HEIGHT)
    await renderSlideOver()

    const { button, glyph, header } = await measureClose()

    expect(button.width).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX)
    expect(button.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX)
    expect(glyph.width).toBe(GLYPH_PX)
    expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth)
  })

  it('is back to 32px at desktop width', async () => {
    await renderSlideOver()

    const { button, glyph } = await measureClose()

    expect(button.width).toBe(DESKTOP_CLOSE_PX)
    expect(button.height).toBe(DESKTOP_CLOSE_PX)
    expect(glyph.width).toBe(GLYPH_PX)
  })
})
