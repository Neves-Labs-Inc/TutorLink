import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { ConversationList } from '@/components/chat/ConversationList'
import type { Conversation } from '@/lib/queries/conversations'
import { renderWithProviders } from '@/test/render-with-providers'

const conversation = (overrides: Partial<Conversation>): Conversation => ({
  id: 'c1',
  phone_number: '+15551234567',
  guardian: { id: 'g1', name: 'Maria Lopez' },
  status: 'bot',
  taken_over_by: null,
  last_message_at: '2026-09-22T09:00:00Z',
  last_message_preview: 'hi',
  unread: false,
  flag_reason: null,
  intake_in_progress: false,
  last_client_message_at: null,
  is_window_open: false,
  flagged_at: null,
  ...overrides,
})

const renderList = (conversations: Conversation[]) =>
  renderWithProviders(
    <ConversationList
      conversations={conversations}
      status="ready"
      onRetry={vi.fn()}
      emptyMessage="none"
      onSelect={vi.fn()}
      now={new Date('2026-09-22T10:00:00Z')}
    />,
  )

describe('ConversationList badges', () => {
  it('shows Intake in progress for a named Guardian when intake_in_progress is true', async () => {
    await renderList([conversation({ intake_in_progress: true })])

    await expect.element(page.getByText('Intake in progress').first()).toBeInTheDocument()
  })

  it('shows no Intake in progress badge when it is false, even for an unnamed number', async () => {
    await renderList([conversation({ guardian: null })])

    await expect.element(page.getByText('+15551234567').first()).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('Intake in progress')
  })

  it('labels the new flag reasons', async () => {
    await renderList([
      conversation({ id: 'a', flag_reason: 'didnt_understand' }),
      conversation({ id: 'b', flag_reason: 'stuck' }),
    ])

    await expect.element(page.getByText('Bot didn’t understand').first()).toBeInTheDocument()
    await expect.element(page.getByText('Bot got stuck').first()).toBeInTheDocument()
  })
})
