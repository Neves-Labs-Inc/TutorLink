import { describe, it, expect } from 'vitest'
import {
  isHeldByAdmin,
  isHeldByOtherAdmin,
  mergeMessagePages,
  messageAlignment,
  messageStatusLabel,
  oldestCreatedAt,
  optimisticMessage,
  reconcileLiveMessage,
} from './chatThread'
import type { Conversation, Message } from './queries/conversations'

const message = (overrides: Partial<Message> & Pick<Message, 'id'>): Message => ({
  author_kind: 'client',
  author: null,
  body: 'hello',
  status: 'received',
  created_at: '2026-09-22T09:00:00Z',
  ...overrides,
})

const conversation = (
  overrides: Partial<Pick<Conversation, 'status' | 'taken_over_by'>>,
): Pick<Conversation, 'status' | 'taken_over_by'> => ({
  status: 'bot',
  taken_over_by: null,
  ...overrides,
})

describe('messageAlignment', () => {
  it('aligns client messages to the start', () => {
    expect(messageAlignment('client')).toBe('start')
  })

  it('aligns bot and admin messages to the end', () => {
    expect(messageAlignment('bot')).toBe('end')
    expect(messageAlignment('admin')).toBe('end')
  })
})

describe('messageStatusLabel', () => {
  it('shows sending for a queued or sent admin message', () => {
    expect(messageStatusLabel({ author_kind: 'admin', status: 'queued' })).toBe('Sending…')
    expect(messageStatusLabel({ author_kind: 'admin', status: 'sent' })).toBe('Sending…')
  })

  it('shows failed for a failed admin message', () => {
    expect(messageStatusLabel({ author_kind: 'admin', status: 'failed' })).toBe('Failed to send')
  })

  it('shows nothing for a delivered admin message', () => {
    expect(messageStatusLabel({ author_kind: 'admin', status: 'delivered' })).toBeNull()
  })

  it('shows nothing for a bot message sitting at sent by design (P7-3)', () => {
    expect(messageStatusLabel({ author_kind: 'bot', status: 'sent' })).toBeNull()
  })

  it('shows nothing for a client message', () => {
    expect(messageStatusLabel({ author_kind: 'client', status: 'received' })).toBeNull()
  })
})

describe('mergeMessagePages', () => {
  it('flattens newest-first pages into oldest-to-newest reading order', () => {
    const newestPage = [message({ id: '3', created_at: '2026-09-22T09:03:00Z' }), message({ id: '2', created_at: '2026-09-22T09:02:00Z' })]
    const olderPage = [message({ id: '1', created_at: '2026-09-22T09:01:00Z' })]

    expect(mergeMessagePages([newestPage, olderPage]).map((m) => m.id)).toEqual(['1', '2', '3'])
  })

  it('de-duplicates a message repeated across pages', () => {
    const newestPage = [message({ id: '2' }), message({ id: '1' })]
    const olderPage = [message({ id: '1' })]

    expect(mergeMessagePages([newestPage, olderPage]).map((m) => m.id)).toEqual(['1', '2'])
  })

  it('returns an empty thread for no pages', () => {
    expect(mergeMessagePages([])).toEqual([])
  })
})

describe('reconcileLiveMessage', () => {
  it('appends a message with no match', () => {
    const thread = [message({ id: '1' })]
    const next = reconcileLiveMessage(thread, message({ id: '2' }))

    expect(next.map((m) => m.id)).toEqual(['1', '2'])
  })

  it('replaces an optimistic bubble keyed by client_message_id with the echoed message', () => {
    const optimistic = optimisticMessage('temp-1', 'hi', 'admin-1', 'admin@tutorlink.com')
    const thread = [message({ id: '0' }), optimistic]
    const echoed = message({ id: 'real-1', author_kind: 'admin', status: 'sent' })

    const next = reconcileLiveMessage(thread, echoed, 'temp-1')

    expect(next).toHaveLength(2)
    expect(next[1]).toBe(echoed)
  })

  it('does not duplicate a message already present by id, as on a resend after a reconnect', () => {
    const thread = [message({ id: '1' })]
    const next = reconcileLiveMessage(thread, message({ id: '1', status: 'delivered' }))

    expect(next).toHaveLength(1)
    expect(next[0].status).toBe('delivered')
  })
})

describe('isHeldByAdmin / isHeldByOtherAdmin', () => {
  it('is held by the admin holding it', () => {
    const held = conversation({
      status: 'human',
      taken_over_by: { id: 'admin-1', email: 'a@tutorlink.com' },
    })

    expect(isHeldByAdmin(held, 'admin-1')).toBe(true)
    expect(isHeldByOtherAdmin(held, 'admin-1')).toBe(false)
  })

  it('is held by another admin', () => {
    const held = conversation({
      status: 'human',
      taken_over_by: { id: 'admin-2', email: 'b@tutorlink.com' },
    })

    expect(isHeldByAdmin(held, 'admin-1')).toBe(false)
    expect(isHeldByOtherAdmin(held, 'admin-1')).toBe(true)
  })

  it('is held by nobody while status is bot', () => {
    const unheld = conversation({})

    expect(isHeldByAdmin(unheld, 'admin-1')).toBe(false)
    expect(isHeldByOtherAdmin(unheld, 'admin-1')).toBe(false)
  })
})

describe('oldestCreatedAt', () => {
  it('reads the first message of an oldest-first thread', () => {
    const thread = [message({ id: '1', created_at: '2026-09-22T09:01:00Z' })]

    expect(oldestCreatedAt(thread)).toBe('2026-09-22T09:01:00Z')
  })

  it('is null for an empty thread', () => {
    expect(oldestCreatedAt([])).toBeNull()
  })
})
