import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { MessageThread, type MessageThreadProps } from '@/components/chat/MessageThread'
import type { Message } from '@/lib/queries/conversations'
import { renderWithProviders } from '@/test/render-with-providers'

const adminMessage = (id: string, status: Message['status']): Message => ({
  id,
  author_kind: 'admin',
  author: null,
  body: `body ${id}`,
  status,
  created_at: '2026-09-22T09:00:00Z',
  system_kind: null,
  error_code: null,
  reminder_child_names: null,
})

const propsFor = (messages: Message[]): MessageThreadProps => ({
  messages,
  hasMore: false,
  loadingMore: false,
  onLoadMore: vi.fn(),
  loadState: 'ready',
  loadError: '',
  onRetryLoad: vi.fn(),
  olderFailed: false,
  lastSentId: null,
  isWindowOpen: true,
  retry: { isPending: false, pendingId: null, error: null, onRetry: vi.fn() },
})

const liveRegionText = () => document.querySelector('[aria-live="polite"]')?.textContent?.trim()

describe('MessageThread failure announcement', () => {
  it('announces the count when several messages fail in one update, then the singular for one', async () => {
    const pending = [adminMessage('a', 'queued'), adminMessage('b', 'queued'), adminMessage('c', 'queued')]
    const { rerender } = await renderWithProviders(<MessageThread {...propsFor(pending)} />)

    await rerender(
      <MessageThread
        {...propsFor([adminMessage('a', 'failed'), adminMessage('b', 'failed'), adminMessage('c', 'queued')])}
      />,
    )
    await expect.poll(liveRegionText).toBe('2 messages failed to send.')
    await expect.element(page.getByText('Failed to send').first()).toBeVisible()

    await rerender(
      <MessageThread
        {...propsFor([adminMessage('a', 'failed'), adminMessage('b', 'failed'), adminMessage('c', 'failed')])}
      />,
    )
    await expect.poll(liveRegionText).toBe('A message failed to send.')
  })
})

const botMessage = (id: string, status: Message['status']): Message => ({
  ...adminMessage(id, status),
  author_kind: 'bot',
})

const handoffNote = (status: Message['status']): Message => ({
  ...adminMessage('note', status),
  author_kind: 'system',
  body: 'Wants a trial lesson for Emma',
  system_kind: 'handoff_note',
})

describe('MessageThread bot replies and handoff notes', () => {
  it('marks a failed bot reply as failed with no Retry button', async () => {
    await renderWithProviders(<MessageThread {...propsFor([botMessage('b', 'failed')])} />)

    await expect.element(page.getByText('Failed to send')).toBeVisible()
    expect(document.querySelector('[data-retry]')).toBeNull()
    expect(document.body.textContent).not.toContain('Retry')
  })

  it.each(['queued', 'sent', 'delivered'] as const)('shows no delivery mark on a bot reply at %s', async (status) => {
    await renderWithProviders(<MessageThread {...propsFor([botMessage('b', status)])} />)

    await expect.element(page.getByText('body b')).toBeVisible()
    expect(document.body.textContent).not.toMatch(/Sending|Sent|Delivered|Failed to send/)
  })

  it('renders a handoff note as a muted Staff-only line, never failed, with no Retry', async () => {
    await renderWithProviders(<MessageThread {...propsFor([handoffNote('failed')])} />)

    const line = page.getByText('Bot’s handoff note: Wants a trial lesson for Emma')
    await expect.element(line).toBeVisible()
    expect(line.element().className).toContain('text-muted-foreground')
    expect(line.element().className).not.toContain('text-destructive')
    expect(document.body.textContent).not.toContain('Retry')
  })
})
