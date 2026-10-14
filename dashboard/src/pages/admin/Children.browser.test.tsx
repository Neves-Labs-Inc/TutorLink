import { queryOptions } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { Children } from '@/pages/admin/Children'
import type { ChildSummary } from '@/lib/queries/children'
import { renderWithProviders } from '@/test/render-with-providers'

const DESKTOP_WIDTH = 1280
const DESKTOP_HEIGHT = 800

const api = vi.hoisted(() => ({
  listChildren: vi.fn(),
  getChildDetail: vi.fn(),
}))

vi.mock('@/lib/queries/children', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queries/children')>()),
  childQueries: {
    list: (params: object) =>
      queryOptions({ queryKey: ['children', 'list', params], queryFn: api.listChildren }),
    detail: (childId: string) =>
      queryOptions({ queryKey: ['children', 'detail', childId], queryFn: api.getChildDetail }),
  },
}))

const LUCAS: ChildSummary = {
  id: 'child-1',
  name: 'Lucas Souza',
  grade_level: 5,
  school_name: 'Lincoln Elementary',
  is_active: true,
  guardians: [],
  homes: [],
  next_session: null,
  evaluated: null,
  created_at: '2026-01-01T00:00:00Z',
}

const renderChildren = () =>
  renderWithProviders(
    <MemoryRouter>
      <Children />
    </MemoryRouter>,
  )

const deactivateDialog = () => page.getByRole('dialog', { name: 'Deactivate child' })

describe('Children deactivate dialog', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await page.viewport(DESKTOP_WIDTH, DESKTOP_HEIGHT)
    api.listChildren.mockResolvedValue({ items: [LUCAS], total: 1, page: 1, page_size: 20 })
  })

  it('can still be dismissed when the upcoming-session count fails to load', async () => {
    api.getChildDetail.mockRejectedValue(new Error('Network down'))
    await renderChildren()

    await userEvent.click(page.getByRole('button', { name: 'Deactivate' }))
    await expect.element(deactivateDialog().getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect.element(deactivateDialog().getByRole('button', { name: 'Cancel' })).toBeEnabled()
    await expect.element(deactivateDialog().getByRole('button', { name: 'Deactivate' })).toBeDisabled()

    await userEvent.keyboard('{Escape}')
    await expect.element(deactivateDialog()).not.toBeInTheDocument()
  })

  it('can be cancelled while the upcoming-session count is loading', async () => {
    api.getChildDetail.mockReturnValue(new Promise(() => {}))
    await renderChildren()

    await userEvent.click(page.getByRole('button', { name: 'Deactivate' }))
    await expect.element(deactivateDialog().getByText('Loading…')).toBeVisible()

    await userEvent.click(deactivateDialog().getByRole('button', { name: 'Cancel' }))
    await expect.element(deactivateDialog()).not.toBeInTheDocument()
  })
})
