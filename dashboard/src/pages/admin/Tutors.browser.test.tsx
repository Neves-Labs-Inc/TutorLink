import { queryOptions } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { Tutors } from '@/pages/admin/Tutors'
import type { Tutor } from '@/lib/queries/tutors'
import { ADMIN_CONTENT_WIDTH_XL, ADMIN_CONTENT_WIDTHS, findBrokenWords } from '@/test/brokenWords'
import { renderWithProviders } from '@/test/render-with-providers'
import { settleLayout } from '@/test/settleLayout'

const MOBILE_WIDTH = 375
const DESKTOP_WIDTH = 1280
const VIEWPORT_HEIGHT = 800
const LONG_SUBJECT = 'Matematica'.repeat(6)

const api = vi.hoisted(() => ({ listTutors: vi.fn(), listSubjects: vi.fn() }))

vi.mock('@/lib/queries/tutors', () => ({
  tutorQueries: {
    list: (params: object) =>
      queryOptions({ queryKey: ['tutors', 'list', params], queryFn: api.listTutors }),
  },
}))

vi.mock('@/lib/queries/subjects', () => ({
  subjectQueries: {
    list: (params: object) =>
      queryOptions({ queryKey: ['subjects', 'list', params], queryFn: api.listSubjects }),
  },
  createSubject: vi.fn(),
  updateSubject: vi.fn(),
  deactivateSubject: vi.fn(),
}))

const TUTOR: Tutor = {
  id: 'tutor-a',
  user_id: 'user-a',
  name: 'Ana Souza',
  email: 'ana@example.com',
  phone_number: '+15551234567',
  bio: null,
  is_active: true,
  subjects: [{ subject_id: 's1', name: LONG_SUBJECT, max_grade_level: 12 }],
}
const ORDINARY_TUTOR: Tutor = {
  ...TUTOR,
  id: 'tutor-b',
  name: 'Carla Mendes',
  email: 'carla.mendes.oliveira@example.com',
  subjects: [{ subject_id: 's2', name: 'Biology', max_grade_level: 8 }],
}

// `width` stands in for the admin shell's content column beside the sidebar.
const renderTutors = (width?: number) =>
  renderWithProviders(
    <MemoryRouter>
      <div style={{ width }}>
        <Tutors />
      </div>
    </MemoryRouter>,
  )

const findAll = (selector: string, text: string): HTMLElement | undefined =>
  Array.from(document.querySelectorAll<HTMLElement>(selector)).find((element) =>
    element.textContent?.includes(text),
  )

describe('Tutors long subject names', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.listSubjects.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 })
    api.listTutors.mockResolvedValue({
      items: [TUTOR, ORDINARY_TUTOR],
      total: 2,
      page: 1,
      page_size: 20,
    })
  })

  it('wraps the value inside its card on a phone', async () => {
    await page.viewport(MOBILE_WIDTH, VIEWPORT_HEIGHT)
    await renderTutors()
    await expect.poll(() => findAll('ul dd', LONG_SUBJECT)).toBeDefined()
    await settleLayout()

    const value = findAll('ul dd', LONG_SUBJECT)!
    const card = value.closest<HTMLElement>('[data-slot="card"]')!
    const label = value.previousElementSibling as HTMLElement

    expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth)
    expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(MOBILE_WIDTH)
    // The label keeps its natural width, so it stays on one line while the value wraps.
    expect(label.getBoundingClientRect().height).toBeLessThan(value.getBoundingClientRect().height)
  })

  it('keeps the table inside its container on desktop', async () => {
    await page.viewport(DESKTOP_WIDTH, VIEWPORT_HEIGHT)
    await renderTutors(ADMIN_CONTENT_WIDTH_XL)
    await expect.poll(() => findAll('td', LONG_SUBJECT)).toBeDefined()
    await settleLayout()

    const cell = findAll('td', LONG_SUBJECT)!
    const scroller = cell.closest<HTMLElement>('.overflow-x-auto')!
    const lineHeight = parseFloat(getComputedStyle(cell).lineHeight)

    expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(DESKTOP_WIDTH)
    expect(cell.getBoundingClientRect().height).toBeGreaterThan(lineHeight * 2)
  })

  for (const width of ADMIN_CONTENT_WIDTHS) {
    it(`keeps ordinary words whole beside the long name in a ${width}px container`, async () => {
      await page.viewport(DESKTOP_WIDTH, VIEWPORT_HEIGHT)
      await renderTutors(width)
      await expect.poll(() => findAll('td', 'Biology')).toBeDefined()
      await settleLayout()

      const cells = Array.from(document.querySelectorAll<HTMLElement>('td'))
      const ordinaryWords = findBrokenWords(cells).filter((word) => !word.includes(LONG_SUBJECT))

      expect(ordinaryWords).toEqual([])
      expect(document.querySelector('td [title]')).toBeNull()
    })
  }
})
