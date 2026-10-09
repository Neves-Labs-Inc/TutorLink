import { describe, it, expect } from 'vitest'
import {
  defaultWindow,
  EMPTY_SESSION_FILTERS,
  filterByChildName,
  searchHintLabel,
  sessionFilterSearchParams,
  sessionFiltersFromSearchParams,
  sessionListParams,
  windowLabel,
  type SessionFilterState,
  type SessionTab,
  type SessionWindow,
} from './tutorSessions'
import type { Booking, BookingListParams } from '../queries/bookings'

const TODAY = '2026-09-22'

const booking = (id: string, childName: string): Booking => ({
  id,
  child: { id: `child-${id}`, name: childName },
  staff: { id: 'user-1', name: 'Tutor One', role: 'tutor' },
  kind: 'regular',
  location: 'home',
  subject: { id: 'subject-1', name: 'Maths' },
  scheduled_date: '2026-09-22',
  start_time: '09:00:00',
  end_time: '10:00:00',
  status: 'confirmed',
  notes: null,
  updated_at: '2026-09-21T10:00:00Z',
})

describe('defaultWindow', () => {
  const cases: { name: string; tab: SessionTab; today: string; expected: SessionWindow }[] = [
    {
      name: 'upcoming is open-ended forward from today',
      tab: 'upcoming',
      today: TODAY,
      expected: { from: TODAY },
    },
    {
      name: 'past runs from the first of the current month to yesterday',
      tab: 'past',
      today: TODAY,
      expected: { from: '2026-09-01', to: '2026-09-21' },
    },
    {
      name: 'past on the 1st falls back to yesterday alone rather than an inverted window',
      tab: 'past',
      today: '2026-09-01',
      expected: { from: '2026-08-31', to: '2026-08-31' },
    },
    {
      name: 'past on the 1st of January crosses the year boundary',
      tab: 'past',
      today: '2026-01-01',
      expected: { from: '2025-12-31', to: '2025-12-31' },
    },
    {
      name: 'past on the 2nd is a two-day window',
      tab: 'past',
      today: '2026-09-02',
      expected: { from: '2026-09-01', to: '2026-09-01' },
    },
  ]

  it.each(cases)('$name', ({ tab, today, expected }) => {
    expect(defaultWindow(tab, today)).toEqual(expected)
  })

  it('never returns a window running backwards', () => {
    const isos = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-09-22', '2026-12-31']

    for (const today of isos) {
      const { from = '', to = '' } = defaultWindow('past', today)

      expect(from <= to).toBe(true)
    }
  })
})

describe('sessionListParams', () => {
  const cases: { name: string; state: SessionFilterState; expected: BookingListParams }[] = [
    {
      name: 'the upcoming default',
      state: EMPTY_SESSION_FILTERS,
      expected: { from: TODAY },
    },
    {
      name: 'the past default',
      state: { ...EMPTY_SESSION_FILTERS, tab: 'past' },
      expected: { from: '2026-09-01', to: '2026-09-21' },
    },
    {
      name: 'an explicit pair overriding the past default',
      state: { ...EMPTY_SESSION_FILTERS, tab: 'past', from: '2025-01-01', to: '2025-12-31' },
      expected: { from: '2025-01-01', to: '2025-12-31' },
    },
    {
      name: 'a widened From with the To end cleared',
      state: { ...EMPTY_SESSION_FILTERS, tab: 'past', from: '2020-01-01' },
      expected: { from: '2020-01-01' },
    },
    {
      name: 'a From cleared against a kept To, which reaches everything older',
      state: { ...EMPTY_SESSION_FILTERS, tab: 'past', to: '2026-09-21' },
      expected: { to: '2026-09-21' },
    },
    {
      name: 'an explicit From on the upcoming tab',
      state: { ...EMPTY_SESSION_FILTERS, from: '2026-10-01' },
      expected: { from: '2026-10-01' },
    },
    {
      name: 'an inverted range, passed through untouched',
      state: { ...EMPTY_SESSION_FILTERS, tab: 'past', from: '2026-09-30', to: '2026-09-01' },
      expected: { from: '2026-09-30', to: '2026-09-01' },
    },
  ]

  it.each(cases)('builds params for $name', ({ state, expected }) => {
    expect(sessionListParams(state, TODAY)).toEqual(expected)
  })

  it('never sends a tutor_id, on either tab', () => {
    for (const tab of ['upcoming', 'past'] as SessionTab[]) {
      expect(sessionListParams({ ...EMPTY_SESSION_FILTERS, tab }, TODAY)).not.toHaveProperty(
        'tutor_id',
      )
    }
  })

  it('never sends a status filter, so a cancelled future session stays visible', () => {
    for (const tab of ['upcoming', 'past'] as SessionTab[]) {
      expect(sessionListParams({ ...EMPTY_SESSION_FILTERS, tab }, TODAY)).not.toHaveProperty(
        'status',
      )
    }
  })

  it('ignores the search term, which never reaches the server', () => {
    const params = sessionListParams({ ...EMPTY_SESSION_FILTERS, q: 'Ada' }, TODAY)

    expect(params).toEqual({ from: TODAY })
  })

  it('leaves no gap or overlap at the past/upcoming boundary', () => {
    const past = sessionListParams({ ...EMPTY_SESSION_FILTERS, tab: 'past' }, TODAY)
    const upcoming = sessionListParams(EMPTY_SESSION_FILTERS, TODAY)

    expect(past.to).toBe('2026-09-21')
    expect(upcoming.from).toBe(TODAY)
  })
})

describe('windowLabel', () => {
  const cases: { name: string; params: BookingListParams; expected: string }[] = [
    {
      name: 'a closed window',
      params: { from: '2026-09-01', to: '2026-09-21' },
      expected: 'Sessions from 1 Sep 2026 to 21 Sep 2026',
    },
    {
      name: 'an open-ended forward window',
      params: { from: '2026-09-22' },
      expected: 'Sessions from 22 Sep 2026 onwards',
    },
    {
      name: 'an open-ended backward window',
      params: { to: '2026-09-21' },
      expected: 'Sessions up to 21 Sep 2026',
    },
    { name: 'no window at all', params: {}, expected: 'All sessions' },
  ]

  it.each(cases)('describes $name', ({ params, expected }) => {
    expect(windowLabel(params)).toBe(expected)
  })

  it('names the dates actually queried for each tab default', () => {
    expect(windowLabel(sessionListParams(EMPTY_SESSION_FILTERS, TODAY))).toBe(
      'Sessions from 22 Sep 2026 onwards',
    )
    expect(windowLabel(sessionListParams({ ...EMPTY_SESSION_FILTERS, tab: 'past' }, TODAY))).toBe(
      'Sessions from 1 Sep 2026 to 21 Sep 2026',
    )
  })
})

describe('filterByChildName', () => {
  const rows = [booking('1', 'Ada Lovelace'), booking('2', 'Grace Hopper'), booking('3', 'adam')]

  const cases: { name: string; q: string; expected: string[] }[] = [
    { name: 'an empty term keeps every row', q: '', expected: ['1', '2', '3'] },
    { name: 'a whitespace-only term keeps every row', q: '   ', expected: ['1', '2', '3'] },
    { name: 'a case-insensitive match', q: 'ADA', expected: ['1', '3'] },
    { name: 'a term trimmed before matching', q: '  grace  ', expected: ['2'] },
    { name: 'a substring from the middle of a name', q: 'ovela', expected: ['1'] },
    { name: 'a surname', q: 'Hopper', expected: ['2'] },
    { name: 'a term nothing matches', q: 'zzz', expected: [] },
  ]

  it.each(cases)('$name', ({ q, expected }) => {
    expect(filterByChildName(rows, q).map((row) => row.id)).toEqual(expected)
  })

  it('returns the very same array for an empty term', () => {
    expect(filterByChildName(rows, '')).toBe(rows)
  })

  it('does not mutate the rows it was given', () => {
    filterByChildName(rows, 'ada')

    expect(rows.map((row) => row.id)).toEqual(['1', '2', '3'])
  })
})

describe('searchHintLabel', () => {
  const cases: { shown: number; held: number; expected: string }[] = [
    { shown: 3, held: 20, expected: '3 of 20 sessions on this page match' },
    { shown: 1, held: 20, expected: '1 of 20 sessions on this page matches' },
    { shown: 0, held: 20, expected: '0 of 20 sessions on this page match' },
    { shown: 1, held: 1, expected: '1 of 1 session on this page matches' },
    { shown: 20, held: 20, expected: '20 of 20 sessions on this page match' },
  ]

  it.each(cases)('renders $shown of $held as $expected', ({ shown, held, expected }) => {
    expect(searchHintLabel(shown, held)).toBe(expected)
  })

  it('says "on this page", never anything that reads as the whole history', () => {
    expect(searchHintLabel(3, 20)).toContain('on this page')
  })
})

describe('sessionFiltersFromSearchParams', () => {
  const cases: { name: string; search: string; expected: SessionFilterState }[] = [
    { name: 'an empty query string', search: '', expected: EMPTY_SESSION_FILTERS },
    {
      name: 'the past tab',
      search: 'tab=past',
      expected: { ...EMPTY_SESSION_FILTERS, tab: 'past' },
    },
    {
      name: 'a tab that is neither',
      search: 'tab=archived',
      expected: EMPTY_SESSION_FILTERS,
    },
    {
      name: 'a date window',
      search: 'from=2026-09-01&to=2026-09-21',
      expected: { ...EMPTY_SESSION_FILTERS, from: '2026-09-01', to: '2026-09-21' },
    },
    {
      name: 'a search term',
      search: 'q=Ada',
      expected: { ...EMPTY_SESSION_FILTERS, q: 'Ada' },
    },
    { name: 'params present but blank', search: 'from=&to=&q=', expected: EMPTY_SESSION_FILTERS },
    {
      name: 'params this page does not own',
      search: 'page=3&status=pending',
      expected: EMPTY_SESSION_FILTERS,
    },
    {
      name: 'every filter at once',
      search: 'tab=past&from=2026-09-01&to=2026-09-21&q=Ada',
      expected: { tab: 'past', from: '2026-09-01', to: '2026-09-21', q: 'Ada' },
    },
  ]

  it.each(cases)('reads $name', ({ search, expected }) => {
    expect(sessionFiltersFromSearchParams(new URLSearchParams(search))).toEqual(expected)
  })
})

describe('sessionFilterSearchParams', () => {
  const cases: { name: string; state: SessionFilterState; expected: string }[] = [
    { name: 'the default tab, which is omitted', state: EMPTY_SESSION_FILTERS, expected: '' },
    { name: 'the past tab', state: { ...EMPTY_SESSION_FILTERS, tab: 'past' }, expected: 'tab=past' },
    {
      name: 'a date window',
      state: { ...EMPTY_SESSION_FILTERS, from: '2026-09-01', to: '2026-09-21' },
      expected: 'from=2026-09-01&to=2026-09-21',
    },
    {
      name: 'every filter at once',
      state: { tab: 'past', from: '2026-09-01', to: '2026-09-21', q: 'Ada Lovelace' },
      expected: 'tab=past&from=2026-09-01&to=2026-09-21&q=Ada+Lovelace',
    },
  ]

  it.each(cases)('writes $name', ({ state, expected }) => {
    expect(sessionFilterSearchParams(state).toString()).toBe(expected)
  })
})

describe('session filter URL round trip', () => {
  const states: { name: string; state: SessionFilterState }[] = [
    { name: 'an empty filter set', state: EMPTY_SESSION_FILTERS },
    { name: 'the past tab alone', state: { ...EMPTY_SESSION_FILTERS, tab: 'past' } },
    {
      name: 'a widened past window',
      state: { ...EMPTY_SESSION_FILTERS, tab: 'past', from: '2020-01-01', to: '2026-09-21' },
    },
    { name: 'a one-ended window', state: { ...EMPTY_SESSION_FILTERS, to: '2026-09-21' } },
    {
      name: 'every filter at once',
      state: { tab: 'past', from: '2026-09-01', to: '2026-09-21', q: 'Ada' },
    },
  ]

  it.each(states)('survives state to params to state for $name', ({ state }) => {
    const parsed = sessionFiltersFromSearchParams(sessionFilterSearchParams(state))

    expect(parsed).toEqual(state)
  })

  it.each(states)('reaches the same request params through the URL for $name', ({ state }) => {
    const parsed = sessionFiltersFromSearchParams(sessionFilterSearchParams(state))

    expect(sessionListParams(parsed, TODAY)).toEqual(sessionListParams(state, TODAY))
  })
})
