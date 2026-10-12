/// <reference types="@vitest/browser-playwright" />
import { queryOptions } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cdp, page } from 'vitest/browser'

import { Guardians } from '@/pages/admin/Guardians'
import type { Household } from '@/lib/queries/households'
import { renderWithProviders } from '@/test/render-with-providers'
import { settleLayout } from '@/test/settleLayout'

const MOBILE_WIDTH = 375
const DESKTOP_WIDTH = 1280
const VIEWPORT_HEIGHT = 800
const SKELETON_CARD_COUNT = 6
const HEIGHT_TOLERANCE_PX = 2

const api = vi.hoisted(() => ({ listHouseholds: vi.fn() }))

vi.mock('@/lib/queries/households', () => ({
  householdQueries: {
    list: (params: object) =>
      queryOptions({ queryKey: ['households', 'list', params], queryFn: api.listHouseholds }),
  },
}))

const HOUSEHOLD: Household = {
  key: 'h1',
  guardians: [{ id: 'g1', name: 'Maria Souza', phone_number: '+15551234567', is_active: true }],
  children: [{ id: 'c1', name: 'Lucas Souza', grade_level: 5, is_active: true }],
}

const renderGuardians = () =>
  renderWithProviders(
    <MemoryRouter>
      <Guardians />
    </MemoryRouter>,
  )

const busyRegion = () => document.querySelector<HTMLElement>('[aria-busy="true"]')
const skeletonCards = () =>
  Array.from(busyRegion()?.querySelectorAll<HTMLElement>('[aria-hidden="true"]') ?? [])

describe('Guardians loading skeleton', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await page.viewport(MOBILE_WIDTH, VIEWPORT_HEIGHT)
    api.listHouseholds.mockReturnValue(new Promise(() => {}))
  })

  afterEach(async () => {
    // Emulated media lives on the shared browser page; clear it so later tests see the default.
    await cdp().send('Emulation.setEmulatedMedia', { features: [] })
  })

  it('announces loading in a single busy region', async () => {
    await renderGuardians()

    await expect.poll(busyRegion).not.toBeNull()

    await settleLayout()
    expect(document.querySelectorAll('[aria-busy="true"]')).toHaveLength(1)
    expect(busyRegion()!.querySelector('.sr-only')?.textContent).toBe('Loading guardians…')
    expect(skeletonCards()).toHaveLength(SKELETON_CARD_COUNT)
  })

  it('stops every bar animating under reduced motion', async () => {
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    })
    await renderGuardians()
    await expect.poll(busyRegion).not.toBeNull()
    await settleLayout()

    const bars = skeletonCards().flatMap((card) =>
      Array.from(card.querySelectorAll<HTMLElement>('.bg-muted')),
    )

    expect(bars.length).toBeGreaterThan(0)
    expect(bars.every((bar) => getComputedStyle(bar).animationName === 'none')).toBe(true)
  })

  it('lays cards out in one column on a phone and three on desktop', async () => {
    await renderGuardians()
    await expect.poll(busyRegion).not.toBeNull()
    await settleLayout()
    const columnCount = () =>
      new Set(skeletonCards().map((card) => Math.round(card.getBoundingClientRect().left))).size

    expect(columnCount()).toBe(1)
    await page.viewport(DESKTOP_WIDTH, VIEWPORT_HEIGHT)
    await expect.poll(columnCount).toBe(3)
  })

  it('matches the height of a loaded one-guardian, one-child card', async () => {
    const skeleton = await renderGuardians()
    await expect.poll(busyRegion).not.toBeNull()
    await settleLayout()
    const skeletonHeight = skeletonCards()[0].getBoundingClientRect().height
    await skeleton.unmount()

    api.listHouseholds.mockResolvedValue({ items: [HOUSEHOLD], total: 1, page: 1, page_size: 20 })
    await renderGuardians()
    await expect.poll(() => document.querySelector('h2')).not.toBeNull()
    await settleLayout()
    const loadedHeight = document
      .querySelector('h2')!
      .closest<HTMLElement>('[data-slot="card"]')!
      .getBoundingClientRect().height

    expect(Math.abs(skeletonHeight - loadedHeight)).toBeLessThanOrEqual(HEIGHT_TOLERANCE_PX)
  })

  it('starts the skeleton grid where the loaded grid will sit', async () => {
    const skeleton = await renderGuardians()
    await expect.poll(busyRegion).not.toBeNull()
    await settleLayout()
    const skeletonTop = skeletonCards()[0].getBoundingClientRect().top
    await skeleton.unmount()

    api.listHouseholds.mockResolvedValue({ items: [HOUSEHOLD], total: 1, page: 1, page_size: 20 })
    await renderGuardians()
    await expect.poll(() => document.querySelector('h2')).not.toBeNull()
    await settleLayout()
    const loadedTop = document
      .querySelector('h2')!
      .closest<HTMLElement>('[data-slot="card"]')!
      .getBoundingClientRect().top

    expect(Math.abs(skeletonTop - loadedTop)).toBeLessThanOrEqual(HEIGHT_TOLERANCE_PX)
  })
})
