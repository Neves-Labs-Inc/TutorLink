import { describe, it, expect } from 'vitest'
import {
  conversationDisplayName,
  conversationHolderLabel,
  conversationListParams,
  isErrorFlag,
  relativeTimeLabel,
  EMPTY_FILTERS,
  type ConversationFilterState,
} from './chatList'
import type { Conversation, ConversationListParams } from './queries/conversations'

describe('conversationListParams', () => {
  const cases: {
    name: string
    state: ConversationFilterState
    expected: ConversationListParams
  }[] = [
    {
      name: 'carries only paging with no filters set',
      state: EMPTY_FILTERS,
      expected: { page: 1, page_size: 20 },
    },
    {
      name: 'adds status when set',
      state: { ...EMPTY_FILTERS, status: 'human' },
      expected: { page: 1, page_size: 20, status: 'human' },
    },
    {
      name: 'adds unread when true',
      state: { ...EMPTY_FILTERS, unread: true },
      expected: { page: 1, page_size: 20, unread: true },
    },
    {
      name: 'adds flagged when true',
      state: { ...EMPTY_FILTERS, flagged: true },
      expected: { page: 1, page_size: 20, flagged: true },
    },
    {
      name: 'drops a whitespace-only search term',
      state: { ...EMPTY_FILTERS, q: '   ' },
      expected: { page: 1, page_size: 20 },
    },
    {
      name: 'trims and keeps a search term',
      state: { ...EMPTY_FILTERS, q: '  jane  ' },
      expected: { page: 1, page_size: 20, q: 'jane' },
    },
    {
      name: 'composes every filter together',
      state: { status: 'bot', unread: true, flagged: true, q: '555' },
      expected: { page: 2, page_size: 20, status: 'bot', unread: true, flagged: true, q: '555' },
    },
  ]

  it.each(cases)('$name', ({ state, expected }) => {
    const page = expected.page ?? 1

    expect(conversationListParams(state, page, 20)).toEqual(expected)
  })
})

describe('conversationDisplayName', () => {
  const base: Conversation = {
    id: '1',
    phone_number: '+15551234567',
    guardian: null,
    status: 'bot',
    taken_over_by: null,
    last_message_at: '2026-08-20T14:31:02Z',
    last_message_preview: 'hi',
    unread: false,
    flag_reason: null,
  }

  it('renders the bare phone number when guardian is null', () => {
    expect(conversationDisplayName(base)).toBe('+15551234567')
  })

  it('renders the guardian name when present', () => {
    expect(
      conversationDisplayName({ ...base, guardian: { id: 'g1', name: 'Jane Doe' } }),
    ).toBe('Jane Doe')
  })
})

describe('conversationHolderLabel', () => {
  const base: Conversation = {
    id: '1',
    phone_number: '+15551234567',
    guardian: null,
    status: 'bot',
    taken_over_by: null,
    last_message_at: '2026-08-20T14:31:02Z',
    last_message_preview: 'hi',
    unread: false,
    flag_reason: null,
  }

  it('is null while the bot is answering', () => {
    expect(conversationHolderLabel(base)).toBeNull()
  })

  it('names the holder when under takeover', () => {
    expect(
      conversationHolderLabel({
        ...base,
        status: 'human',
        taken_over_by: { id: 'u1', email: 'admin@tutorlink.com' },
      }),
    ).toBe('admin@tutorlink.com')
  })
})

describe('isErrorFlag', () => {
  it('treats stuck and parse_error as errors', () => {
    expect(isErrorFlag('stuck')).toBe(true)
    expect(isErrorFlag('parse_error')).toBe(true)
  })

  it('treats guardian_link_request as not an error', () => {
    expect(isErrorFlag('guardian_link_request')).toBe(false)
  })
})

describe('relativeTimeLabel', () => {
  const now = new Date('2026-08-20T15:00:00Z')

  it.each([
    ['2026-08-20T14:59:30Z', 'just now'],
    ['2026-08-20T14:58:00Z', '2m ago'],
    ['2026-08-20T13:00:00Z', '2h ago'],
    ['2026-08-18T15:00:00Z', '2d ago'],
    ['2026-08-01T15:00:00Z', formatDate('2026-08-01')],
  ])('renders %s as %s', (iso, expected) => {
    expect(relativeTimeLabel(iso, now)).toBe(expected)
  })
})

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ]

  return `${day} ${months[month - 1]} ${year}`
}
