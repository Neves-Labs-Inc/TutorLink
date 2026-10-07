import { describe, it, expect, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { api } from './api'
import {
  applyMessageToPages,
  applyMessageUpdate,
  assembleThread,
  canMarkHandled,
  failedAnnouncement,
  canTransfer,
  isTakeoverOffered,
  isTransferOffered,
  takeoverClosedNotice,
  TAKEOVER_CLOSED_NOTICE,
  composerClosedNotice,
  handBackConfirmBody,
  joinNames,
  lastWroteAgo,
  systemLineLabel,
  transferConfirmBody,
  isHeldByAdmin,
  markMessagesFailed,
  socketSaysClosed,
  focusRequest,
  refusalFocusTarget,
  isFocusAdrift,
  isFocusRequestLive,
  isHeldByOtherAdmin,
  markConversationHandled,
  mergeMessagePages,
  messageAlignment,
  messageStatusLabel,
  oldestCreatedAt,
  optimisticMessage,
  reconcileLiveMessage,
} from './chatThread'
import type { Conversation, ConversationDetail, FlagReason, Message } from './queries/conversations'
import type { Page } from './queries/page'

const message = (overrides: Partial<Message> & Pick<Message, 'id'>): Message => ({
  author_kind: 'client',
  author: null,
  body: 'hello',
  status: 'received',
  created_at: '2026-09-22T09:00:00Z',
  system_kind: null,
  error_code: null,
  reminder_child_names: null,
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
  it.each([
    ['queued', 'Sending…'],
    ['sent', 'Sent'],
    ['delivered', 'Delivered'],
    ['failed', 'Failed to send'],
  ] as const)('labels an admin message at %s as %s', (status, label) => {
    expect(messageStatusLabel({ author_kind: 'admin', status })).toBe(label)
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

  it('labels an optimistic bubble with the sender Display name', () => {
    expect(optimisticMessage('temp-1', 'hi', 'admin-1', 'Maria Lopez').author).toEqual({
      id: 'admin-1',
      display_name: 'Maria Lopez',
    })
  })

  it('replaces an optimistic bubble keyed by client_message_id with the echoed message', () => {
    const optimistic = optimisticMessage('temp-1', 'hi', 'admin-1', 'Maria Lopez')
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

describe('applyMessageUpdate', () => {
  it('replaces only the message with the matching id and keeps the order', () => {
    const thread = [
      message({ id: '1', author_kind: 'admin', status: 'sent' }),
      message({ id: '2', author_kind: 'admin', status: 'sent' }),
      message({ id: '3' }),
    ]
    const updated = message({ id: '2', author_kind: 'admin', status: 'delivered' })

    expect(applyMessageUpdate(thread, updated)).toEqual([thread[0], updated, thread[2]])
  })

  it('leaves the thread unchanged when the id is not on screen', () => {
    const thread = [message({ id: '1' })]

    expect(applyMessageUpdate(thread, message({ id: 'elsewhere', status: 'delivered' }))).toBe(thread)
  })
})

describe('assembleThread', () => {
  it('prefers the refetched server copy over a pending echo with the same id', () => {
    const pendingEcho = message({ id: 'real-1', author_kind: 'admin', status: 'sent' })
    const refetched = message({ id: 'real-1', author_kind: 'admin', status: 'delivered' })

    const thread = assembleThread([message({ id: '0' }), refetched], [pendingEcho])

    expect(thread.map((m) => [m.id, m.status])).toEqual([
      ['0', 'received'],
      ['real-1', 'delivered'],
    ])
  })

  it('appends pending messages the pages do not carry yet', () => {
    const optimistic = optimisticMessage('temp-1', 'hi', 'admin-1', 'Maria Lopez')

    const thread = assembleThread([message({ id: '0' })], [optimistic])

    expect(thread.map((m) => m.id)).toEqual(['0', 'temp-1'])
  })
})

describe('applyMessageToPages', () => {
  const QUERY_PREFIX = ['conversations', 'detail', 'c-1', 'messages']
  const PAGE_KEY = [...QUERY_PREFIX, {}]
  const pageOf = (items: Message[]): Page<Message> => ({ items, total: items.length, page: 1, page_size: 50 })

  it('patches the status in every cached page', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(PAGE_KEY, pageOf([message({ id: 'm-1', author_kind: 'admin', status: 'sent' })]))

    await applyMessageToPages(
      queryClient,
      QUERY_PREFIX,
      message({ id: 'm-1', author_kind: 'admin', status: 'delivered' }),
    )

    expect(queryClient.getQueryData<Page<Message>>(PAGE_KEY)?.items[0].status).toBe('delivered')
  })

  it('keeps the new status when a fetch already in flight lands with an older snapshot', async () => {
    const queryClient = new QueryClient()
    const sent = message({ id: 'm-1', author_kind: 'admin', status: 'sent' })
    queryClient.setQueryData(PAGE_KEY, pageOf([sent]))
    let landStaleFetch: (page: Page<Message>) => void = () => {}
    const staleFetch = queryClient
      .fetchQuery({
        queryKey: PAGE_KEY,
        queryFn: () => new Promise<Page<Message>>((resolve) => (landStaleFetch = resolve)),
        staleTime: 0,
      })
      .catch(() => undefined)

    await applyMessageToPages(
      queryClient,
      QUERY_PREFIX,
      message({ id: 'm-1', author_kind: 'admin', status: 'delivered' }),
    )
    landStaleFetch(pageOf([sent]))
    await staleFetch

    expect(queryClient.getQueryData<Page<Message>>(PAGE_KEY)?.items[0].status).toBe('delivered')
  })
})

describe('failedAnnouncement', () => {
  it('announces nothing before any failure', () => {
    expect(failedAnnouncement(0)).toBe('')
  })

  it('changes the live-region text on a second failure while saying the same words', () => {
    const first = failedAnnouncement(1)
    const second = failedAnnouncement(2)

    expect(second).not.toBe(first)
    expect(first.trim()).toBe('A message failed to send.')
    expect(second.trim()).toBe('A message failed to send.')
  })

  it('changes the text again on a third failure', () => {
    expect(failedAnnouncement(3)).not.toBe(failedAnnouncement(2))
  })
})

describe('isHeldByAdmin / isHeldByOtherAdmin', () => {
  it('is held by the admin holding it', () => {
    const held = conversation({
      status: 'human',
      taken_over_by: { id: 'admin-1', display_name: 'Ana' },
    })

    expect(isHeldByAdmin(held, 'admin-1')).toBe(true)
    expect(isHeldByOtherAdmin(held, 'admin-1')).toBe(false)
  })

  it('is held by another admin', () => {
    const held = conversation({
      status: 'human',
      taken_over_by: { id: 'admin-2', display_name: 'Ben' },
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

describe('canMarkHandled', () => {
  const detail = (
    overrides: Partial<Pick<ConversationDetail, 'flag_reason' | 'flagged_at'>>,
  ): Pick<ConversationDetail, 'flag_reason' | 'flagged_at'> => ({
    flag_reason: null,
    flagged_at: null,
    ...overrides,
  })

  const handleableReasons: FlagReason[] = ['stuck', 'parse_error', 'guardian_link_request']

  it.each(handleableReasons)('is true for %s with a flagged_at', (flagReason) => {
    expect(canMarkHandled(detail({ flag_reason: flagReason, flagged_at: '2026-09-23T10:00:00Z' }))).toBe(
      true,
    )
  })

  it('is false for reactivation_request', () => {
    expect(
      canMarkHandled(detail({ flag_reason: 'reactivation_request', flagged_at: '2026-09-23T10:00:00Z' })),
    ).toBe(false)
  })

  it('is false for no flag', () => {
    expect(canMarkHandled(detail({}))).toBe(false)
  })

  it('is false when flagged_at is null despite a handleable reason', () => {
    expect(canMarkHandled(detail({ flag_reason: 'stuck', flagged_at: null }))).toBe(false)
  })
})

describe('markConversationHandled', () => {
  it('sends the given flagged_at token unchanged', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: {} })

    await markConversationHandled('conversation-1', '2026-09-23T10:00:00.123456Z')

    expect(post).toHaveBeenCalledWith('/api/conversations/conversation-1/handled', {
      flagged_at: '2026-09-23T10:00:00.123456Z',
    })

    post.mockRestore()
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

const systemMessage = (overrides: Partial<Message>): Message =>
  message({ id: 's1', author_kind: 'system', status: 'sent', ...overrides })

const marta = { id: 'u1', display_name: 'Marta' }

describe('systemLineLabel', () => {
  it('drops Retry on a failed takeover or transfer notice while the window is closed', () => {
    const failed = (system_kind: Message['system_kind']) =>
      systemLineLabel(
        systemMessage({ system_kind, status: 'failed', error_code: 'template_not_approved' }),
        false,
      )

    expect(failed('takeover_notice')).toEqual({
      text: 'Takeover notice not delivered (template not approved)',
      isFailed: true,
      canRetry: false,
    })
    expect(failed('transfer_notice').canRetry).toBe(false)
  })

  it('keeps the window_closed failure label without Retry', () => {
    expect(
      systemLineLabel(
        systemMessage({ system_kind: 'transfer_notice', status: 'failed', error_code: 'window_closed' }),
        false,
      ),
    ).toEqual({ text: 'Transfer notice not delivered (window closed)', isFailed: true, canRetry: false })
  })

  it('reads a sent takeover notice with the staff name', () => {
    expect(
      systemLineLabel(systemMessage({ system_kind: 'takeover_notice', author: marta }), true),
    ).toEqual({ text: 'Marta joined the chat · notice sent', isFailed: false, canRetry: false })
  })

  it('moves a takeover notice through sending, delivered and read', () => {
    const textFor = (status: Message['status']) =>
      systemLineLabel(systemMessage({ system_kind: 'transfer_notice', author: marta, status }), true).text

    expect(textFor('queued')).toBe('Marta joined the chat · sending notice')
    expect(textFor('delivered')).toBe('Marta joined the chat · delivered')
    expect(textFor('read')).toBe('Marta joined the chat · read')
  })

  it('falls back to Staff when the notice has no author', () => {
    expect(systemLineLabel(systemMessage({ system_kind: 'takeover_notice' }), true).text).toBe(
      'Staff joined the chat · notice sent',
    )
  })

  it('fails a takeover notice with a readable reason and offers Retry while the window is open', () => {
    const failed = (error_code: string | null) =>
      systemLineLabel(
        systemMessage({ system_kind: 'takeover_notice', status: 'failed', error_code }),
        true,
      )

    expect(failed('template_not_approved')).toEqual({
      text: 'Takeover notice not delivered (template not approved)',
      isFailed: true,
      canRetry: true,
    })
    expect(failed('63016').text).toBe('Takeover notice not delivered (error 63016)')
    expect(failed(null).text).toBe('Takeover notice not delivered')
  })

  it('labels a failed transfer notice and offers Retry while the window is open', () => {
    expect(
      systemLineLabel(
        systemMessage({ system_kind: 'transfer_notice', status: 'failed', error_code: 'window_closed' }), true),
    ).toEqual({
      text: 'Transfer notice not delivered (window closed)',
      isFailed: true,
      canRetry: true,
    })
  })

  it('reads hand-back notices, including the closed-window failure', () => {
    expect(systemLineLabel(systemMessage({ system_kind: 'handback_notice' }), true).text).toBe(
      'Hand-back notice sent',
    )
    expect(
      systemLineLabel(systemMessage({ system_kind: 'handback_notice', status: 'queued' }), true).text,
    ).toBe('Hand-back notice sending')
    expect(
      systemLineLabel(
        systemMessage({ system_kind: 'handback_notice', status: 'failed', error_code: 'window_closed' }), true),
    ).toEqual({ text: 'Hand-back notice not sent (window closed)', isFailed: true, canRetry: false })
    expect(
      systemLineLabel(
        systemMessage({ system_kind: 'handback_notice', status: 'failed', error_code: '63016' }), true).text,
    ).toBe('Hand-back notice not delivered (error 63016)')
  })

  it('names the children on a weekly reminder', () => {
    expect(
      systemLineLabel(
        systemMessage({
          system_kind: 'booking_reminder',
          status: 'delivered',
          reminder_child_names: ['Ana', 'Luis'],
        }), true).text,
    ).toBe('Weekly reminder sent: Ana and Luis · delivered')
    expect(systemLineLabel(systemMessage({ system_kind: 'booking_reminder' }), true).text).toBe(
      'Weekly reminder sent · sent',
    )
    expect(
      systemLineLabel(
        systemMessage({
          system_kind: 'booking_reminder',
          status: 'failed',
          error_code: '63016',
          reminder_child_names: ['Ana'],
        }), true),
    ).toEqual({
      text: 'Weekly reminder not delivered: Ana (error 63016)',
      isFailed: true,
      canRetry: false,
    })
  })

  it('reads consent notices and their failure without Retry', () => {
    expect(
      systemLineLabel(systemMessage({ system_kind: 'consent_notice', status: 'queued' }), true).text,
    ).toBe('Reminder setting confirmed to Guardian · sending')
    expect(
      systemLineLabel(
        systemMessage({ system_kind: 'consent_notice', status: 'failed', error_code: 'window_closed' }), true),
    ).toEqual({
      text: 'Reminder setting confirmation not delivered (window closed)',
      isFailed: true,
      canRetry: false,
    })
  })
})

describe('joinNames', () => {
  it('joins one, two and three names', () => {
    expect(joinNames(['Ana'])).toBe('Ana')
    expect(joinNames(['Ana', 'Luis'])).toBe('Ana and Luis')
    expect(joinNames(['Ana', 'Luis', 'Sofía'])).toBe('Ana, Luis and Sofía')
    expect(joinNames([])).toBe('')
  })
})

describe('lastWroteAgo', () => {
  const now = new Date('2026-09-23T12:00:00Z')

  it('counts whole hours under 48 hours', () => {
    expect(lastWroteAgo('2026-09-22T09:30:00Z', now)).toBe('26 hours ago')
    expect(lastWroteAgo('2026-09-23T10:30:00Z', now)).toBe('1 hour ago')
  })

  it('switches to whole days from 48 hours', () => {
    expect(lastWroteAgo('2026-09-21T12:00:00Z', now)).toBe('2 days ago')
    expect(lastWroteAgo('2026-09-19T01:00:00Z', now)).toBe('4 days ago')
  })
})

describe('composerClosedNotice', () => {
  const now = new Date('2026-09-23T12:00:00Z')
  const detail = {
    is_window_open: false,
    last_client_message_at: '2026-09-22T09:00:00Z',
    guardian: { id: 'g1', name: 'Rosa Martínez' },
    phone_number: '+5550101',
  }

  it('is null while the window is open', () => {
    expect(composerClosedNotice({ ...detail, is_window_open: true }, now, false)).toBeNull()
  })

  it('explains a closed window', () => {
    expect(composerClosedNotice(detail, now, false)).toBe(
      'Rosa Martínez last wrote 27 hours ago. WhatsApp only allows replies within 24 hours of their last message.',
    )
  })

  it('treats a socket window_closed as closed even when the data says open', () => {
    expect(composerClosedNotice({ ...detail, is_window_open: true }, now, true)).not.toBeNull()
  })

  it('uses the phone number and says so when the guardian never wrote', () => {
    expect(
      composerClosedNotice({ ...detail, guardian: null, last_client_message_at: null }, now, false),
    ).toBe(
      "+5550101 hasn't written yet. WhatsApp only allows replies within 24 hours of their last message.",
    )
  })
})

describe('canTransfer', () => {
  it('shows only when someone else holds the chat', () => {
    expect(canTransfer(conversation({ status: 'human', taken_over_by: marta }), 'u2')).toBe(true)
    expect(canTransfer(conversation({ status: 'human', taken_over_by: marta }), 'u1')).toBe(false)
    expect(canTransfer(conversation({ status: 'bot' }), 'u1')).toBe(false)
  })
})

describe('confirm bodies', () => {
  it('names who takes over, and drops that while the caller is unknown', () => {
    expect(transferConfirmBody('Marta', 'Joao')).toBe(
      'Marta is holding this chat. Take it over as Joao? Marta can no longer reply here.',
    )
    expect(transferConfirmBody('Marta', null)).toBe(
      'Marta is holding this chat. Take it over? Marta can no longer reply here.',
    )
  })

  it('falls back to "another Staff member", capitalised to open the sentence, when the holder is unknown', () => {
    expect(transferConfirmBody(null, null)).toBe(
      'Another Staff member is holding this chat. Take it over? another Staff member can no longer reply here.',
    )
  })

  it('keeps a lowercase holder name exactly as written', () => {
    expect(transferConfirmBody('marta lópez', null)).toBe(
      'marta lópez is holding this chat. Take it over? marta lópez can no longer reply here.',
    )
  })

  it('warns that the hand-back starts a fresh flow', () => {
    expect(handBackConfirmBody('Rosa')).toBe(
      'The bot starts a fresh flow, not from where this conversation left off. Rosa is told the booking assistant is back if they wrote in the last 24 hours.',
    )
  })
})

describe('markMessagesFailed', () => {
  it('fails only the named messages and keeps their text', () => {
    const thread = [
      message({ id: 'a', author_kind: 'admin', status: 'queued', body: 'hi' }),
      message({ id: 'b', author_kind: 'admin', status: 'queued' }),
    ]

    const next = markMessagesFailed(thread, new Set(['a']))

    expect(next[0]).toMatchObject({ status: 'failed', body: 'hi' })
    expect(next[1].status).toBe('queued')
  })
})

describe('markMessagesFailed with several unsent bubbles', () => {
  it('fails every named bubble', () => {
    const thread = [
      message({ id: 'a', author_kind: 'admin', status: 'queued' }),
      message({ id: 'b', author_kind: 'admin', status: 'queued' }),
    ]

    expect(markMessagesFailed(thread, new Set(['a', 'b'])).map((m) => m.status)).toEqual([
      'failed',
      'failed',
    ])
  })
})

describe('socketSaysClosed', () => {
  const flag = { lastClientMessageAt: '2026-09-22T09:00:00Z' }

  it('holds while the Guardian has not written again', () => {
    expect(socketSaysClosed(flag, { last_client_message_at: '2026-09-22T09:00:00Z' })).toBe(true)
  })

  it('resets once the Guardian writes again', () => {
    expect(socketSaysClosed(flag, { last_client_message_at: '2026-09-23T10:00:00Z' })).toBe(false)
  })

  it('is false when the socket never said closed', () => {
    expect(socketSaysClosed(null, { last_client_message_at: null })).toBe(false)
  })

  it('holds for a Guardian who never wrote', () => {
    expect(socketSaysClosed({ lastClientMessageAt: null }, { last_client_message_at: null })).toBe(true)
  })
})

describe('focus requests', () => {
  const NOW = 1_000_000

  it('stays live right after it is made', () => {
    expect(isFocusRequestLive(focusRequest(['textarea'], NOW), NOW + 100)).toBe(true)
  })

  it('lapses a second after it is made, so an unmatched target never pulls focus later', () => {
    expect(isFocusRequestLive(focusRequest(['textarea'], NOW), NOW + 1_000)).toBe(false)
  })

  it('is not live when there is none', () => {
    expect(isFocusRequestLive(null, NOW)).toBe(false)
  })
})

describe('isFocusAdrift', () => {
  it('counts focus on <body> as lost', () => {
    expect(isFocusAdrift({ kind: 'body' })).toBe(true)
  })

  it('counts focus left in a closing dialog as about to be lost', () => {
    expect(isFocusAdrift({ kind: 'dialog', state: 'closed' })).toBe(true)
  })

  it('leaves focus in an open dialog alone', () => {
    expect(isFocusAdrift({ kind: 'dialog', state: 'open' })).toBe(false)
  })

  it('leaves focus in a sheet with no open or closed state alone, like the mobile nav', () => {
    expect(isFocusAdrift({ kind: 'dialog', state: null })).toBe(false)
  })

  it('leaves focus on a control in the page alone', () => {
    expect(isFocusAdrift({ kind: 'page' })).toBe(false)
  })
})

describe('refusalFocusTarget', () => {
  // Stands in for querySelector over the chat panel: returns the selector when it is mounted.
  const mountedOnly =
    (...mounted: string[]) =>
    (selector: string): string | null =>
      mounted.includes(selector) ? selector : null

  it('moves to the closed-window line once it replaces a refused Take over', () => {
    expect(refusalFocusTarget({ kind: 'takeover' }, mountedOnly('[data-takeover-closed]'))).toBe(
      '[data-takeover-closed]',
    )
  })

  it('moves to Transfer to me when the refused Take over turned out to be held by another', () => {
    expect(refusalFocusTarget({ kind: 'takeover' }, mountedOnly('[data-transfer]'))).toBe('[data-transfer]')
  })

  it('returns to the re-enabled Take over while the refetch has not replaced it', () => {
    expect(
      refusalFocusTarget({ kind: 'takeover' }, mountedOnly('[data-takeover]:not([disabled])')),
    ).toBe('[data-takeover]:not([disabled])')
  })

  it('moves to the header line when a refused Transfer is closed after the refetch', () => {
    expect(
      refusalFocusTarget({ kind: 'transfer' }, mountedOnly('[data-takeover-closed]', '[data-hand-back]')),
    ).toBe('[data-takeover-closed]')
  })

  it('returns to the refused Retry while it is still offered', () => {
    expect(
      refusalFocusTarget(
        { kind: 'retry', messageId: 'notice-1' },
        mountedOnly('[data-hand-back]', '[data-retry="notice-1"]:not([disabled])'),
      ),
    ).toBe('[data-retry="notice-1"]:not([disabled])')
  })

  it('moves to Hand back once the refetch removes a refused Retry from my chat', () => {
    expect(
      refusalFocusTarget(
        { kind: 'retry', messageId: 'notice-1' },
        mountedOnly('[data-retry="notice-2"]:not([disabled])', '[data-hand-back]'),
      ),
    ).toBe('[data-hand-back]')
  })

  it('finds nothing when no control is mounted', () => {
    expect(refusalFocusTarget({ kind: 'transfer' }, mountedOnly())).toBeNull()
  })
})

describe('window-dependent takeover decisions', () => {
  const open = { is_window_open: true }
  const closed = { is_window_open: false }

  it('offers Take over only while the window is open', () => {
    expect(isTakeoverOffered(open)).toBe(true)
    expect(isTakeoverOffered(closed)).toBe(false)
  })

  it('offers Transfer to me only while the window is open', () => {
    expect(isTransferOffered(open)).toBe(true)
    expect(isTransferOffered(closed)).toBe(false)
  })

  it('explains a closed window and says nothing while it is open', () => {
    expect(takeoverClosedNotice(closed)).toBe(
      "Window closed: take over is only possible within 24 hours of the Guardian's last message.",
    )
    expect(takeoverClosedNotice(closed)).toBe(TAKEOVER_CLOSED_NOTICE)
    expect(takeoverClosedNotice(open)).toBeNull()
  })
})
