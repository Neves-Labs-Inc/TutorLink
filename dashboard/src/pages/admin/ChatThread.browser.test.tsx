import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { ChatThread } from '@/pages/admin/ChatThread'
import type { ConversationDetail } from '@/lib/queries/conversations'
import { renderWithProviders } from '@/test/render-with-providers'

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: http,
}))
vi.mock('@/hooks/use-conversation-stream/useConversationStream', () => ({
  useConversationStream: () => ({ send: vi.fn(), status: 'closed' }),
}))

const detail = (overrides: Partial<ConversationDetail>): ConversationDetail => ({
  id: 'c1',
  phone_number: '+15551234567',
  guardian: { id: 'g1', name: 'Maria Lopez' },
  status: 'bot',
  taken_over_by: null,
  last_message_at: '2026-09-22T09:00:00Z',
  flag_reason: null,
  intake_in_progress: false,
  taken_over_at: null,
  last_read_at: '2026-09-22T09:00:00Z',
  message_count: 0,
  unread_count: 0,
  created_at: '2026-09-22T09:00:00Z',
  reactivation_request: null,
  flagged_at: null,
  is_window_open: true,
  last_client_message_at: null,
  language: null,
  ...overrides,
})

const renderThread = (conversation: ConversationDetail) => {
  http.get.mockImplementation(async (url: string) => {
    if (url.endsWith('/messages')) return { data: { items: [], total: 0, page: 1, page_size: 50 } }
    if (url === '/api/me') return { data: { id: 'u1', email: 'a@b.c', role: 'admin', name: 'Ana' } }
    return { data: conversation }
  })
  http.post.mockResolvedValue({ data: conversation })

  return renderWithProviders(
    <MemoryRouter initialEntries={['/chats/c1']}>
      <Routes>
        <Route path="/chats/:id" element={<ChatThread />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ChatThread header Intake in progress badge', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows for a named Guardian when intake_in_progress is true', async () => {
    await renderThread(detail({ intake_in_progress: true }))

    await expect.element(page.getByText('Intake in progress')).toBeVisible()
  })

  it('is absent for an unnamed number when intake_in_progress is false', async () => {
    await renderThread(detail({ guardian: null }))

    await expect.element(page.getByRole('heading', { name: '+15551234567' })).toBeVisible()
    expect(document.body.textContent).not.toContain('Intake in progress')
  })
})
