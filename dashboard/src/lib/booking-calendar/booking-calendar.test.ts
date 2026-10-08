import { describe, expect, it } from 'vitest'

import { EMPTY_FILTERS } from '../bookings/bookings'
import type { Booking } from '../queries/bookings'
import {
  bookingViewFromSearchParams,
  calendarListParams,
  groupBookingsByDay,
  remainingPages,
  withBookingView,
} from './booking-calendar'

const booking = (overrides: Partial<Booking> = {}): Booking => ({
  id: 'booking-1',
  child: { id: 'child-1', name: 'Ana Souza' },
  tutor: { id: 'tutor-1', name: 'Maria Lima' },
  subject: { id: 'subject-1', name: 'Maths' },
  scheduled_date: '2026-09-21',
  start_time: '16:00:00',
  end_time: '17:00:00',
  status: 'confirmed',
  notes: null,
  ...overrides,
})

describe('bookingViewFromSearchParams', () => {
  const cases: { name: string; search: string; expected: string }[] = [
    { name: 'no view param means list', search: '', expected: 'list' },
    { name: 'view=calendar', search: 'view=calendar', expected: 'calendar' },
    { name: 'view=list', search: 'view=list', expected: 'list' },
    { name: 'an unknown view falls back to list', search: 'view=month', expected: 'list' },
  ]

  it.each(cases)('$name', ({ search, expected }) => {
    expect(bookingViewFromSearchParams(new URLSearchParams(search))).toBe(expected)
  })
})

describe('withBookingView', () => {
  it('adds view=calendar and keeps every other param, including repeated status', () => {
    const search = new URLSearchParams('status=pending&status=confirmed&tutor_id=tutor-1')

    const result = withBookingView(search, 'calendar')

    expect(result.getAll('status')).toEqual(['pending', 'confirmed'])
    expect(result.get('tutor_id')).toBe('tutor-1')
    expect(result.get('view')).toBe('calendar')
  })

  it('removes the view param for list, so the list URL stays as it was before', () => {
    const search = new URLSearchParams('view=calendar&from=2026-09-01&to=2026-09-30')

    const result = withBookingView(search, 'list')

    expect(result.has('view')).toBe(false)
    expect(result.toString()).toBe('from=2026-09-01&to=2026-09-30')
  })

  it('does not mutate the search params it was given', () => {
    const search = new URLSearchParams('status=pending')

    withBookingView(search, 'calendar')

    expect(search.has('view')).toBe(false)
  })
})

describe('calendarListParams', () => {
  it("overrides from and to with the week's Monday and Sunday", () => {
    const filters = { ...EMPTY_FILTERS, from: '2026-01-01', to: '2026-12-31' }

    expect(calendarListParams(filters, '2026-09-21')).toEqual({
      from: '2026-09-21',
      to: '2026-09-27',
    })
  })

  it('keeps tutor, subject, child and status filters', () => {
    const filters = {
      statuses: ['pending', 'confirmed'] as const,
      tutorId: 'tutor-1',
      subjectId: 'subject-1',
      childId: 'child-1',
      from: '',
      to: '',
    }

    expect(
      calendarListParams({ ...filters, statuses: [...filters.statuses] }, '2026-12-28'),
    ).toEqual({
      status: ['pending', 'confirmed'],
      tutor_id: 'tutor-1',
      subject_id: 'subject-1',
      child_id: 'child-1',
      from: '2026-12-28',
      to: '2027-01-03',
    })
  })
})

describe('groupBookingsByDay', () => {
  it('returns seven days in order, Monday first, each sorted by start_time', () => {
    const bookings = [
      booking({ id: 'sun-late', scheduled_date: '2026-09-27', start_time: '15:00:00' }),
      booking({ id: 'mon-late', scheduled_date: '2026-09-21', start_time: '16:00:00' }),
      booking({ id: 'mon-early', scheduled_date: '2026-09-21', start_time: '09:00:00' }),
      booking({ id: 'sun-early', scheduled_date: '2026-09-27', start_time: '08:30:00' }),
    ]

    const days = groupBookingsByDay(bookings, '2026-09-21')

    expect(days.map((day) => day.dayIso)).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
    ])
    expect(days[0].bookings.map((entry) => entry.id)).toEqual(['mon-early', 'mon-late'])
    expect(days[6].bookings.map((entry) => entry.id)).toEqual(['sun-early', 'sun-late'])
    expect(days.slice(1, 6).every((day) => day.bookings.length === 0)).toBe(true)
  })

  it('drops bookings outside the week', () => {
    const bookings = [
      booking({ id: 'before', scheduled_date: '2026-09-20' }),
      booking({ id: 'inside', scheduled_date: '2026-09-23' }),
      booking({ id: 'after', scheduled_date: '2026-09-28' }),
    ]

    const days = groupBookingsByDay(bookings, '2026-09-21')

    expect(days.flatMap((day) => day.bookings.map((entry) => entry.id))).toEqual(['inside'])
  })
})

describe('remainingPages', () => {
  const cases: { name: string; total: number; expected: number[] }[] = [
    { name: 'an empty week needs no more pages', total: 0, expected: [] },
    { name: 'a total under the page size needs no more pages', total: 57, expected: [] },
    { name: 'a total equal to the page size needs no more pages', total: 100, expected: [] },
    { name: 'one over the page size needs page 2', total: 101, expected: [2] },
    { name: 'a total spanning three pages needs pages 2 and 3', total: 250, expected: [2, 3] },
  ]

  it.each(cases)('$name', ({ total, expected }) => {
    expect(remainingPages(total, 100)).toEqual(expected)
  })
})
