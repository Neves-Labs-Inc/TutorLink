import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { api } from './api'
import {
  applyMessageToPages,
  applyMessageUpdate,
  assembleThread,
  messageAreaState,
  olderPageState,
  joinNames,
  focusRequest,
  isFocusRequestLive,
  markConversationHandled,
  mergeMessagePages,
  oldestCreatedAt,
  optimisticMessage,
  reconcileLiveMessage,
} from './chatThread'
import type { Message } from './queries/conversations'
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
      name: 'Maria Lopez',
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

  it('fetches again after cancelling an in-flight fetch of an active query', async () => {
    const queryClient = new QueryClient()
    const delivered = message({ id: 'm-1', author_kind: 'admin', status: 'delivered' })
    const resolvers: Array<(page: Page<Message>) => void> = []
    const queryFn = vi.fn(() => new Promise<Page<Message>>((resolve) => resolvers.push(resolve)))
    const observer = new QueryObserver(queryClient, { queryKey: PAGE_KEY, queryFn, retry: false })
    const unsubscribe = observer.subscribe(() => {})
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1))

    await applyMessageToPages(queryClient, QUERY_PREFIX, delivered)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
    // The server answers the second fetch with the update applied.
    resolvers[1](pageOf([delivered]))
    await vi.waitFor(() =>
      expect(queryClient.getQueryData<Page<Message>>(PAGE_KEY)?.items[0].status).toBe('delivered'),
    )
    unsubscribe()
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

describe('joinNames', () => {
  it('joins one, two and three names', () => {
    expect(joinNames(['Ana'])).toBe('Ana')
    expect(joinNames(['Ana', 'Luis'])).toBe('Ana and Luis')
    expect(joinNames(['Ana', 'Luis', 'Sofía'])).toBe('Ana, Luis and Sofía')
    expect(joinNames([])).toBe('')
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

describe('messageAreaState', () => {
  const page = (
    overrides: Partial<{ hasData: boolean; isPending: boolean; isFetching: boolean; isError: boolean }>,
  ) => ({
    isPending: false,
    hasData: false,
    isFetching: false,
    isError: false,
    ...overrides,
  })

  it('is loading while the first page is fetching without data', () => {
    expect(messageAreaState(page({ isFetching: true }), 0)).toBe('loading')
  })

  it('is loading while the first page is pending but not fetching (paused offline)', () => {
    expect(messageAreaState(page({ isPending: true }), 0)).toBe('loading')
  })

  it('stays loading when a pending message exists before the page lands', () => {
    expect(messageAreaState(page({ isFetching: true }), 1)).toBe('loading')
  })

  it('is loading again during a retry refetch rather than showing the stale error', () => {
    expect(messageAreaState(page({ isFetching: true, isError: true }), 0)).toBe('loading')
  })

  it('is error when the first page failed and is idle', () => {
    expect(messageAreaState(page({ isError: true }), 0)).toBe('error')
  })

  it('is empty only after a successful load with no messages', () => {
    expect(messageAreaState(page({ hasData: true }), 0)).toBe('empty')
  })

  it('is ready when the load succeeded with no items but a pending message exists', () => {
    expect(messageAreaState(page({ hasData: true }), 1)).toBe('ready')
  })

  it('is ready when messages loaded, even while a background refetch runs', () => {
    expect(messageAreaState(page({ hasData: true, isFetching: true }), 3)).toBe('ready')
  })
})

describe('olderPageState', () => {
  it('is idle when no cursor page was requested', () => {
    expect(olderPageState(null)).toBe('idle')
  })

  it('is fetching while the newest cursor page loads', () => {
    expect(olderPageState({ isPending: false, hasData: false, isFetching: true, isError: false })).toBe('fetching')
  })

  it('is fetching during a retry of a failed cursor page', () => {
    expect(olderPageState({ isPending: false, hasData: false, isFetching: true, isError: true })).toBe('fetching')
  })

  it('is error when the newest cursor page failed', () => {
    expect(olderPageState({ isPending: false, hasData: false, isFetching: false, isError: true })).toBe('error')
  })

  it('is idle when a landed cursor page only failed a background refetch', () => {
    expect(olderPageState({ isPending: false, hasData: true, isFetching: false, isError: true })).toBe('idle')
  })

  it('is idle once the cursor page landed', () => {
    expect(olderPageState({ isPending: false, hasData: true, isFetching: false, isError: false })).toBe('idle')
  })
})
