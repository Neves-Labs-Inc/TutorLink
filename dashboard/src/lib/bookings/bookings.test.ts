import { describe, it, expect } from 'vitest'
import {
  activeFilterCount,
  bookingCountLabel,
  bookingFilterSearchParams,
  bookingFiltersFromSearchParams,
  bookingListParams,
  bookingTimeLabel,
  clearedFilters,
  EMPTY_FILTERS,
  emptyBookingsMessage,
  kindTabCount,
  statusLabel,
  STATUS_OPTIONS,
  toggleStatus,
  type BookingFilterState,
  type BookingStatus,
} from './bookings'
import type { BookingListParams } from '../queries/bookings'

describe('bookingListParams', () => {
  const cases: { name: string; state: BookingFilterState; expected: BookingListParams }[] =
    [
      { name: 'every field empty', state: EMPTY_FILTERS, expected: {} },
      {
        name: 'one status',
        state: { ...EMPTY_FILTERS, statuses: ['pending'] },
        expected: { status: ['pending'] },
      },
      {
        name: 'all four statuses',
        state: { ...EMPTY_FILTERS, statuses: [...STATUS_OPTIONS] },
        expected: { status: ['pending', 'confirmed', 'cancelled', 'completed'] },
      },
      {
        name: 'a staff member and a subject',
        state: { ...EMPTY_FILTERS, staffId: 'user-1', subjectId: 'subject-1' },
        expected: { user_id: 'user-1', subject_id: 'subject-1' },
      },
      {
        name: 'a child',
        state: { ...EMPTY_FILTERS, childId: 'child-1' },
        expected: { child_id: 'child-1' },
      },
      {
        name: 'the Evaluation kind tab',
        state: { ...EMPTY_FILTERS, kind: 'evaluation' },
        expected: { kind: 'evaluation' },
      },
      {
        name: 'the Regular kind tab',
        state: { ...EMPTY_FILTERS, kind: 'regular' },
        expected: { kind: 'regular' },
      },
      {
        name: 'an In office location',
        state: { ...EMPTY_FILTERS, location: 'in_office' },
        expected: { location: 'in_office' },
      },
      {
        name: 'an At a home location',
        state: { ...EMPTY_FILTERS, location: 'home' },
        expected: { location: 'home' },
      },
      {
        name: 'a date range',
        state: { ...EMPTY_FILTERS, from: '2026-09-01', to: '2026-09-30' },
        expected: { from: '2026-09-01', to: '2026-09-30' },
      },
      {
        name: 'an inverted date range, passed through untouched',
        state: { ...EMPTY_FILTERS, from: '2026-09-30', to: '2026-09-01' },
        expected: { from: '2026-09-30', to: '2026-09-01' },
      },
      {
        name: 'every filter together',
        state: {
          statuses: ['confirmed'],
          kind: 'evaluation',
          staffId: 'user-1',
          location: 'in_office',
          subjectId: 'subject-1',
          childId: 'child-1',
          from: '2026-09-01',
          to: '2026-09-30',
        },
        expected: {
          status: ['confirmed'],
          kind: 'evaluation',
          user_id: 'user-1',
          location: 'in_office',
          subject_id: 'subject-1',
          child_id: 'child-1',
          from: '2026-09-01',
          to: '2026-09-30',
        },
      },
    ]

  it.each(cases)('builds params for $name', ({ state, expected }) => {
    expect(bookingListParams(state)).toEqual(expected)
  })

  it('omits status entirely when nothing is selected', () => {
    expect(bookingListParams(EMPTY_FILTERS)).not.toHaveProperty('status')
  })

  it('drops a staff member and a subject cleared back to all', () => {
    const params = bookingListParams({ ...EMPTY_FILTERS, staffId: '', subjectId: '' })

    expect(params).not.toHaveProperty('user_id')
    expect(params).not.toHaveProperty('subject_id')
  })

  it('drops a child cleared back to all', () => {
    expect(bookingListParams({ ...EMPTY_FILTERS, childId: '' })).not.toHaveProperty('child_id')
  })

  it('omits kind and location on the All tab with every location', () => {
    const params = bookingListParams({ ...EMPTY_FILTERS, kind: '', location: '' })

    expect(params).not.toHaveProperty('kind')
    expect(params).not.toHaveProperty('location')
  })

  it('sends the Staff member as user_id, never as the old tutor_id', () => {
    const params = bookingListParams({ ...EMPTY_FILTERS, staffId: 'user-1' })

    expect(params).toEqual({ user_id: 'user-1' })
    expect(params).not.toHaveProperty('tutor_id')
  })

  it('has no tutorId in the filter state', () => {
    expect(EMPTY_FILTERS).not.toHaveProperty('tutorId')
    const stale = { ...EMPTY_FILTERS, tutorId: 'tutor-1' } as BookingFilterState

    expect(bookingListParams(stale)).toEqual({})
  })
})

describe('bookingFiltersFromSearchParams', () => {
  const cases: { name: string; search: string; expected: BookingFilterState }[] = [
    { name: 'an empty query string', search: '', expected: EMPTY_FILTERS },
    {
      name: 'a staff deep link',
      search: 'user_id=user-1',
      expected: { ...EMPTY_FILTERS, staffId: 'user-1' },
    },
    {
      name: 'a child deep link',
      search: 'child_id=child-1',
      expected: { ...EMPTY_FILTERS, childId: 'child-1' },
    },
    {
      name: 'the Evaluation tab',
      search: 'kind=evaluation',
      expected: { ...EMPTY_FILTERS, kind: 'evaluation' },
    },
    {
      name: 'a kind that is not one of the two, read as All',
      search: 'kind=trial',
      expected: EMPTY_FILTERS,
    },
    {
      name: 'an In office location',
      search: 'location=in_office',
      expected: { ...EMPTY_FILTERS, location: 'in_office' },
    },
    {
      name: 'a location that is not one of the two, read as all locations',
      search: 'location=school',
      expected: EMPTY_FILTERS,
    },
    {
      name: 'the old tutor_id param, which this page no longer reads',
      search: 'tutor_id=tutor-1',
      expected: EMPTY_FILTERS,
    },
    {
      name: 'repeated status keys',
      search: 'status=pending&status=confirmed',
      expected: { ...EMPTY_FILTERS, statuses: ['pending', 'confirmed'] },
    },
    {
      name: 'statuses given out of canonical order',
      search: 'status=completed&status=pending',
      expected: { ...EMPTY_FILTERS, statuses: ['pending', 'completed'] },
    },
    {
      name: 'a repeated status, kept once',
      search: 'status=pending&status=pending',
      expected: { ...EMPTY_FILTERS, statuses: ['pending'] },
    },
    {
      name: 'a status that is not one of the four',
      search: 'status=archived',
      expected: EMPTY_FILTERS,
    },
    {
      name: 'the bracketed array form, which is not the shape we write',
      search: 'status[]=pending&status[]=confirmed',
      expected: EMPTY_FILTERS,
    },
    {
      name: 'a param present but blank',
      search: 'user_id=&subject_id=',
      expected: EMPTY_FILTERS,
    },
    {
      name: 'params this page does not own',
      search: 'page=3&sort=date',
      expected: EMPTY_FILTERS,
    },
    {
      name: 'every filter at once',
      search:
        'status=pending&status=confirmed&kind=regular&user_id=user-1&location=home' +
        '&subject_id=subject-1&child_id=child-1&from=2026-09-01&to=2026-09-30',
      expected: {
        statuses: ['pending', 'confirmed'],
        kind: 'regular',
        staffId: 'user-1',
        location: 'home',
        subjectId: 'subject-1',
        childId: 'child-1',
        from: '2026-09-01',
        to: '2026-09-30',
      },
    },
  ]

  it.each(cases)('reads $name', ({ search, expected }) => {
    expect(bookingFiltersFromSearchParams(new URLSearchParams(search))).toEqual(expected)
  })
})

describe('bookingFilterSearchParams', () => {
  const cases: { name: string; state: BookingFilterState; expected: string }[] = [
    { name: 'nothing selected', state: EMPTY_FILTERS, expected: '' },
    {
      name: 'one status',
      state: { ...EMPTY_FILTERS, statuses: ['pending'] },
      expected: 'status=pending',
    },
    {
      name: 'two statuses as repeated keys',
      state: { ...EMPTY_FILTERS, statuses: ['pending', 'confirmed'] },
      expected: 'status=pending&status=confirmed',
    },
    {
      name: 'all four statuses',
      state: { ...EMPTY_FILTERS, statuses: [...STATUS_OPTIONS] },
      expected: 'status=pending&status=confirmed&status=cancelled&status=completed',
    },
    {
      name: 'a staff member alone',
      state: { ...EMPTY_FILTERS, staffId: 'user-1' },
      expected: 'user_id=user-1',
    },
    {
      name: 'a child alone',
      state: { ...EMPTY_FILTERS, childId: 'child-1' },
      expected: 'child_id=child-1',
    },
    {
      name: 'the Regular tab alone',
      state: { ...EMPTY_FILTERS, kind: 'regular' },
      expected: 'kind=regular',
    },
    {
      name: 'the All tab, written as no kind at all',
      state: { ...EMPTY_FILTERS, kind: '' },
      expected: '',
    },
    {
      name: 'a location alone',
      state: { ...EMPTY_FILTERS, location: 'home' },
      expected: 'location=home',
    },
    {
      name: 'every filter at once',
      state: {
        statuses: ['confirmed'],
        kind: 'evaluation',
        staffId: 'user-1',
        location: 'in_office',
        subjectId: 'subject-1',
        childId: 'child-1',
        from: '2026-09-01',
        to: '2026-09-30',
      },
      expected:
        'status=confirmed&kind=evaluation&user_id=user-1&location=in_office' +
        '&subject_id=subject-1&child_id=child-1&from=2026-09-01&to=2026-09-30',
    },
  ]

  it.each(cases)('writes $name', ({ state, expected }) => {
    expect(bookingFilterSearchParams(state).toString()).toBe(expected)
  })

  it('never emits the bracketed array form FastAPI ignores', () => {
    const search = bookingFilterSearchParams({
      ...EMPTY_FILTERS,
      statuses: [...STATUS_OPTIONS],
    }).toString()

    expect(search).not.toContain('status%5B%5D')
    expect(search).not.toContain('status[]')
    expect(search.match(/(^|&)status=/g)).toHaveLength(STATUS_OPTIONS.length)
  })
})

describe('booking filter URL round trip', () => {
  const states: { name: string; state: BookingFilterState }[] = [
    { name: 'an empty filter set', state: EMPTY_FILTERS },
    { name: 'a staff deep link', state: { ...EMPTY_FILTERS, staffId: 'user-1' } },
    { name: 'a child deep link', state: { ...EMPTY_FILTERS, childId: 'child-1' } },
    { name: 'the Evaluation tab', state: { ...EMPTY_FILTERS, kind: 'evaluation' } },
    { name: 'an In office location', state: { ...EMPTY_FILTERS, location: 'in_office' } },
    {
      name: 'multiple statuses',
      state: { ...EMPTY_FILTERS, statuses: ['pending', 'confirmed'] },
    },
    { name: 'all four statuses', state: { ...EMPTY_FILTERS, statuses: [...STATUS_OPTIONS] } },
    {
      name: 'every filter at once',
      state: {
        statuses: ['confirmed', 'completed'],
        kind: 'regular',
        staffId: 'user-1',
        location: 'home',
        subjectId: 'subject-1',
        childId: 'child-1',
        from: '2026-09-01',
        to: '2026-09-30',
      },
    },
  ]

  it.each(states)('survives state to params to state for $name', ({ state }) => {
    const parsed = bookingFiltersFromSearchParams(bookingFilterSearchParams(state))

    expect(parsed).toEqual(state)
  })

  it.each(states)('survives params to state to params for $name', ({ state }) => {
    const search = bookingFilterSearchParams(state).toString()
    const reserialised = bookingFilterSearchParams(
      bookingFiltersFromSearchParams(new URLSearchParams(search)),
    ).toString()

    expect(reserialised).toBe(search)
  })

  it.each(states)('reaches the same request params through the URL for $name', ({ state }) => {
    const parsed = bookingFiltersFromSearchParams(bookingFilterSearchParams(state))

    expect(bookingListParams(parsed)).toEqual(bookingListParams(state))
  })
})

describe('toggleStatus', () => {
  const cases: {
    name: string
    statuses: BookingStatus[]
    status: BookingStatus
    expected: BookingStatus[]
  }[] = [
    { name: 'adds to an empty selection', statuses: [], status: 'pending', expected: ['pending'] },
    {
      name: 'adds a second status',
      statuses: ['pending'],
      status: 'confirmed',
      expected: ['pending', 'confirmed'],
    },
    {
      name: 'removes a selected status',
      statuses: ['pending', 'confirmed'],
      status: 'pending',
      expected: ['confirmed'],
    },
    {
      name: 'removes the last status',
      statuses: ['completed'],
      status: 'completed',
      expected: [],
    },
    {
      name: 'keeps the canonical order regardless of click order',
      statuses: ['completed', 'confirmed'],
      status: 'pending',
      expected: ['pending', 'confirmed', 'completed'],
    },
  ]

  it.each(cases)('$name', ({ statuses, status, expected }) => {
    expect(toggleStatus(statuses, status)).toEqual(expected)
  })

  it('does not mutate the selection it was given', () => {
    const statuses: BookingStatus[] = ['pending']

    toggleStatus(statuses, 'confirmed')

    expect(statuses).toEqual(['pending'])
  })
})

describe('bookingTimeLabel', () => {
  const cases: { start: string; end: string; expected: string }[] = [
    { start: '09:00:00', end: '10:00:00', expected: '9:00 AM – 10:00 AM' },
    { start: '00:00:00', end: '00:30:00', expected: '12:00 AM – 12:30 AM' },
    { start: '12:00:00', end: '13:15:00', expected: '12:00 PM – 1:15 PM' },
    { start: '15:45:00', end: '17:05:00', expected: '3:45 PM – 5:05 PM' },
  ]

  it.each(cases)('renders $start to $end as $expected', ({ start, end, expected }) => {
    expect(bookingTimeLabel({ start_time: start, end_time: end })).toBe(expected)
  })
})

describe('statusLabel', () => {
  const cases: { status: BookingStatus; expected: string }[] = [
    { status: 'pending', expected: 'Pending' },
    { status: 'confirmed', expected: 'Confirmed' },
    { status: 'cancelled', expected: 'Cancelled' },
    { status: 'completed', expected: 'Completed' },
  ]

  it.each(cases)('labels $status as $expected', ({ status, expected }) => {
    expect(statusLabel(status)).toBe(expected)
  })

  it('labels every option', () => {
    expect(STATUS_OPTIONS.map(statusLabel)).toEqual([
      'Pending',
      'Confirmed',
      'Cancelled',
      'Completed',
    ])
  })
})

describe('activeFilterCount', () => {
  const cases: { name: string; state: BookingFilterState; expected: number }[] = [
    { name: 'the empty state', state: EMPTY_FILTERS, expected: 0 },
    {
      name: 'one status',
      state: { ...EMPTY_FILTERS, statuses: ['pending'] },
      expected: 1,
    },
    {
      name: 'each selected status separately',
      state: { ...EMPTY_FILTERS, statuses: ['pending', 'completed', 'cancelled'] },
      expected: 3,
    },
    { name: 'a staff member', state: { ...EMPTY_FILTERS, staffId: 'user-1' }, expected: 1 },
    { name: 'a subject', state: { ...EMPTY_FILTERS, subjectId: 'subject-1' }, expected: 1 },
    { name: 'a child', state: { ...EMPTY_FILTERS, childId: 'child-1' }, expected: 1 },
    { name: 'a location', state: { ...EMPTY_FILTERS, location: 'home' }, expected: 1 },
    {
      name: 'a kind tab, which is not a filter badge',
      state: { ...EMPTY_FILTERS, kind: 'evaluation' },
      expected: 0,
    },
    { name: 'only a from date', state: { ...EMPTY_FILTERS, from: '2026-09-01' }, expected: 1 },
    { name: 'only a to date', state: { ...EMPTY_FILTERS, to: '2026-09-30' }, expected: 1 },
    {
      name: 'a date range, counted as two',
      state: { ...EMPTY_FILTERS, from: '2026-09-01', to: '2026-09-30' },
      expected: 2,
    },
    {
      name: 'every filter together',
      state: {
        statuses: ['pending', 'confirmed'],
        kind: 'evaluation',
        staffId: 'user-1',
        location: 'in_office',
        subjectId: 'subject-1',
        childId: 'child-1',
        from: '2026-09-01',
        to: '2026-09-30',
      },
      expected: 8,
    },
  ]

  it.each(cases)('counts $name', ({ state, expected }) => {
    expect(activeFilterCount(state)).toBe(expected)
  })
})

describe('bookingCountLabel', () => {
  const cases: { total: number; expected: string }[] = [
    { total: 0, expected: '0 bookings' },
    { total: 1, expected: '1 booking' },
    { total: 42, expected: '42 bookings' },
  ]

  it.each(cases)('renders $total as $expected', ({ total, expected }) => {
    expect(bookingCountLabel(total)).toBe(expected)
  })
})

describe('clearedFilters', () => {
  const filters: BookingFilterState = {
    statuses: ['pending'],
    kind: 'evaluation',
    staffId: 'user-1',
    location: 'in_office',
    subjectId: 'subject-1',
    childId: 'child-1',
    from: '2026-09-01',
    to: '2026-09-30',
  }

  it('keeps the kind tab, which is not a filter, and clears everything else', () => {
    expect(clearedFilters(filters, { keepDateRange: false })).toEqual({
      ...EMPTY_FILTERS,
      kind: 'evaluation',
    })
  })

  it('keeps the hidden date range in calendar view, so List gets it back', () => {
    expect(clearedFilters(filters, { keepDateRange: true })).toEqual({
      ...EMPTY_FILTERS,
      kind: 'evaluation',
      from: '2026-09-01',
      to: '2026-09-30',
    })
  })

  it('leaves the All tab as it is', () => {
    const cleared = clearedFilters({ ...filters, kind: '' }, { keepDateRange: false })

    expect(cleared).toEqual(EMPTY_FILTERS)
  })
})

describe('kindTabCount', () => {
  const counts = { regular: 40, evaluation: 2 }

  it('sums both kinds for the All tab', () => {
    expect(kindTabCount('', counts)).toBe(42)
  })

  it('reads each kind for its own tab', () => {
    expect(kindTabCount('regular', counts)).toBe(40)
    expect(kindTabCount('evaluation', counts)).toBe(2)
  })
})

describe('emptyBookingsMessage', () => {
  const cases: { kind: BookingFilterState['kind']; expected: string }[] = [
    { kind: '', expected: 'No bookings match these filters.' },
    { kind: 'regular', expected: 'No Regular bookings match these filters.' },
    { kind: 'evaluation', expected: 'No Evaluations match these filters.' },
  ]

  it.each(cases)('names the $kind tab', ({ kind, expected }) => {
    expect(emptyBookingsMessage(kind)).toBe(expected)
  })
})
