import { describe, it, expect } from 'vitest'

import {
  byDayOfWeek,
  DEFAULT_MODE,
  dayOfWeekFromIso,
  EXCEPTION_REASONS,
  exceptionPreviewLabel,
  exceptionReasonLabel,
  exceptionTimesAcceptable,
  exceptionWindowLabel,
  isDecidable,
  isTimeRangeOrdered,
  MODE_OPTIONS,
  modeHint,
  modeLabel,
  slotRangeLabel,
  timeInputValue,
  weekdaysInRange,
} from './availability'
import type { AvailabilitySlot } from '../queries/availability'
import type { TutorException } from '../queries/exceptions'

const slot = (overrides: Partial<AvailabilitySlot>): AvailabilitySlot => ({
  id: 'slot-1',
  tutor_id: 'tutor-1',
  day_of_week: 0,
  start_time: '09:00:00',
  end_time: '11:00:00',
  is_active: true,
  mode: 'anywhere',
  ...overrides,
})

const exception = (overrides: Partial<TutorException>): TutorException => ({
  id: 'exception-1',
  tutor_id: 'tutor-1',
  start_date: '2026-08-27',
  end_date: '2026-08-27',
  start_time: null,
  end_time: null,
  reason: 'vacation',
  notes: null,
  status: 'pending',
  created_at: '2026-08-01T10:00:00Z',
  ...overrides,
})

describe('dayOfWeekFromIso', () => {
  // 2026-08-24 is a Monday; the seven cases below walk one whole week from it.
  const cases: { iso: string; expected: number; label: string }[] = [
    { iso: '2026-08-24', expected: 0, label: 'Mon' },
    { iso: '2026-08-25', expected: 1, label: 'Tue' },
    { iso: '2026-08-26', expected: 2, label: 'Wed' },
    { iso: '2026-08-27', expected: 3, label: 'Thu' },
    { iso: '2026-08-28', expected: 4, label: 'Fri' },
    { iso: '2026-08-29', expected: 5, label: 'Sat' },
    { iso: '2026-08-30', expected: 6, label: 'Sun' },
  ]

  it.each(cases)('reads $iso as index $expected ($label)', ({ iso, expected }) => {
    expect(dayOfWeekFromIso(iso)).toBe(expected)
  })

  it('never returns JavaScript getDay(), which would put Sunday at 0', () => {
    expect(dayOfWeekFromIso('2026-08-30')).not.toBe(new Date(2026, 7, 30).getDay())
    expect(dayOfWeekFromIso('2026-08-24')).not.toBe(new Date(2026, 7, 24).getDay())
  })

  it('holds across a year boundary', () => {
    expect(dayOfWeekFromIso('2025-12-29')).toBe(0)
    expect(dayOfWeekFromIso('2026-01-04')).toBe(6)
  })

  it('holds across a leap day', () => {
    expect(dayOfWeekFromIso('2024-02-29')).toBe(3)
    expect(dayOfWeekFromIso('2024-03-01')).toBe(4)
  })
})

describe('byDayOfWeek', () => {
  it('returns seven buckets for no slots', () => {
    expect(byDayOfWeek([])).toEqual([[], [], [], [], [], [], []])
  })

  it('puts a Monday slot at index 0 and a Sunday slot at index 6', () => {
    const monday = slot({ id: 'mon', day_of_week: 0 })
    const sunday = slot({ id: 'sun', day_of_week: 6 })
    const days = byDayOfWeek([sunday, monday])

    expect(days[0]).toEqual([monday])
    expect(days[6]).toEqual([sunday])
  })

  it('sorts a bucket by start time regardless of input order', () => {
    const late = slot({ id: 'late', day_of_week: 2, start_time: '16:00:00', end_time: '18:00:00' })
    const early = slot({ id: 'early', day_of_week: 2, start_time: '08:00:00', end_time: '09:00:00' })
    const noon = slot({ id: 'noon', day_of_week: 2, start_time: '12:00:00', end_time: '13:00:00' })

    expect(byDayOfWeek([late, noon, early])[2].map((row) => row.id)).toEqual([
      'early',
      'noon',
      'late',
    ])
  })

  it('leaves a day with no slots empty', () => {
    const days = byDayOfWeek([slot({ day_of_week: 4 })])

    expect(days.map((day) => day.length)).toEqual([0, 0, 0, 0, 1, 0, 0])
  })

  it('keeps deactivated slots, which the grid must still show', () => {
    const withdrawn = slot({ id: 'withdrawn', day_of_week: 5, is_active: false })

    expect(byDayOfWeek([withdrawn])[5]).toEqual([withdrawn])
  })

  it('does not mutate the input array', () => {
    const rows = [
      slot({ id: 'b', start_time: '15:00:00' }),
      slot({ id: 'a', start_time: '07:00:00' }),
    ]

    byDayOfWeek(rows)

    expect(rows.map((row) => row.id)).toEqual(['b', 'a'])
  })
})

describe('weekdaysInRange', () => {
  const cases: { name: string; start: string; end: string; expected: string[] }[] = [
    { name: 'one Monday', start: '2026-08-24', end: '2026-08-24', expected: ['Mon'] },
    {
      name: 'Monday to Wednesday',
      start: '2026-08-24',
      end: '2026-08-26',
      expected: ['Mon', 'Tue', 'Wed'],
    },
    {
      name: 'a weekend crossing into Monday, in range order',
      start: '2026-08-29',
      end: '2026-08-31',
      expected: ['Sat', 'Sun', 'Mon'],
    },
    {
      name: 'a full week',
      start: '2026-08-24',
      end: '2026-08-30',
      expected: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    },
  ]

  it.each(cases)('lists $name', ({ start, end, expected }) => {
    expect(weekdaysInRange(start, end)).toEqual(expected)
  })

  it('never repeats a weekday for a range longer than a week', () => {
    expect(weekdaysInRange('2026-08-24', '2026-09-30')).toHaveLength(7)
  })

  it('is empty when the end precedes the start', () => {
    expect(weekdaysInRange('2026-08-26', '2026-08-24')).toEqual([])
  })
})

describe('slotRangeLabel', () => {
  const cases: { start: string; end: string; expected: string }[] = [
    { start: '09:00:00', end: '11:00:00', expected: '9:00 AM – 11:00 AM' },
    { start: '00:00:00', end: '06:30:00', expected: '12:00 AM – 6:30 AM' },
    { start: '11:30:00', end: '12:00:00', expected: '11:30 AM – 12:00 PM' },
    { start: '12:00:00', end: '13:15:00', expected: '12:00 PM – 1:15 PM' },
    { start: '18:45:00', end: '23:59:00', expected: '6:45 PM – 11:59 PM' },
  ]

  it.each(cases)('labels $start to $end', ({ start, end, expected }) => {
    expect(slotRangeLabel(slot({ start_time: start, end_time: end }))).toBe(expected)
  })
})

describe('exceptionWindowLabel', () => {
  const cases: { name: string; window: Partial<TutorException>; expected: string }[] = [
    {
      name: 'a single all-day date',
      window: { start_date: '2026-08-27', end_date: '2026-08-27' },
      expected: '27 Aug, all day',
    },
    {
      name: 'a multi-day all-day range in one month',
      window: { start_date: '2026-08-27', end_date: '2026-08-29' },
      expected: '27–29 Aug, all day',
    },
    {
      name: 'a range crossing a month',
      window: { start_date: '2026-08-29', end_date: '2026-09-02' },
      expected: '29 Aug – 2 Sep, all day',
    },
    {
      name: 'a range crossing a year',
      window: { start_date: '2026-12-29', end_date: '2027-01-02' },
      expected: '29 Dec – 2 Jan, all day',
    },
    {
      name: 'a single day with hours',
      window: {
        start_date: '2026-08-27',
        end_date: '2026-08-27',
        start_time: '09:00:00',
        end_time: '17:00:00',
      },
      expected: '27 Aug, 9:00 AM – 5:00 PM',
    },
    {
      name: 'a multi-day range with hours, which repeat on every day',
      window: {
        start_date: '2026-08-27',
        end_date: '2026-08-29',
        start_time: '09:00:00',
        end_time: '17:00:00',
      },
      expected: '27–29 Aug, 9:00 AM – 5:00 PM each day',
    },
  ]

  it.each(cases)('labels $name', ({ window, expected }) => {
    expect(exceptionWindowLabel(exception(window))).toBe(expected)
  })

  it('does not read a multi-day window as one continuous absence', () => {
    const label = exceptionWindowLabel(
      exception({
        start_date: '2026-08-24',
        end_date: '2026-08-26',
        start_time: '09:00:00',
        end_time: '17:00:00',
      }),
    )

    expect(label).toContain('each day')
  })

  it('does not compare month numbers across different years', () => {
    const label = exceptionWindowLabel(
      exception({ start_date: '2026-08-27', end_date: '2027-08-29' }),
    )

    expect(label).toBe('27 Aug – 29 Aug, all day')
  })
})

describe('EXCEPTION_REASONS', () => {
  it('lists vacation, personal, sick, and other', () => {
    expect(EXCEPTION_REASONS.map((reason) => reason.value)).toEqual([
      'vacation',
      'personal',
      'sick',
      'other',
    ])
  })
})

describe('exceptionReasonLabel', () => {
  const cases: { reason: string; expected: string }[] = [
    { reason: 'vacation', expected: 'Vacation' },
    { reason: 'personal', expected: 'Personal' },
    { reason: 'sick', expected: 'Sick' },
    { reason: 'other', expected: 'Other' },
  ]

  it.each(cases)('labels $reason as $expected', ({ reason, expected }) => {
    expect(exceptionReasonLabel(reason)).toBe(expected)
  })

  it('falls back to the raw value for an unrecognised reason', () => {
    expect(exceptionReasonLabel('unknown')).toBe('unknown')
  })
})

describe('exceptionPreviewLabel', () => {
  it('names every weekday the window falls on, not just the range span', () => {
    const label = exceptionPreviewLabel({
      start_date: '2026-08-24',
      end_date: '2026-08-26',
      start_time: '09:00:00',
      end_time: '17:00:00',
    })

    expect(label).toBe('Blocks 24–26 Aug, 9:00 AM – 5:00 PM each day — Mon, Tue, Wed.')
  })

  it('covers an all-day single date', () => {
    const label = exceptionPreviewLabel({
      start_date: '2026-08-27',
      end_date: '2026-08-27',
      start_time: null,
      end_time: null,
    })

    expect(label).toBe('Blocks 27 Aug, all day — Thu.')
  })
})

describe('isDecidable', () => {
  const cases: { status: TutorException['status']; expected: boolean }[] = [
    { status: 'pending', expected: true },
    { status: 'approved', expected: false },
    { status: 'rejected', expected: false },
  ]

  it.each(cases)('is $expected for $status', ({ status, expected }) => {
    expect(isDecidable(exception({ status }))).toBe(expected)
  })
})

describe('timeInputValue', () => {
  const cases: { hms: string | null; expected: string }[] = [
    { hms: '09:00:00', expected: '09:00' },
    { hms: '23:45:00', expected: '23:45' },
    { hms: '09:00', expected: '09:00' },
    { hms: null, expected: '' },
  ]

  it.each(cases)('turns $hms into $expected', ({ hms, expected }) => {
    expect(timeInputValue(hms)).toBe(expected)
  })
})

describe('isTimeRangeOrdered', () => {
  const cases: { start: string; end: string; expected: boolean }[] = [
    { start: '09:00', end: '17:00', expected: true },
    { start: '09:00', end: '09:00', expected: false },
    { start: '17:00', end: '09:00', expected: false },
    { start: '', end: '17:00', expected: false },
    { start: '09:00', end: '', expected: false },
    { start: '', end: '', expected: false },
  ]

  it.each(cases)('is $expected for "$start" to "$end"', ({ start, end, expected }) => {
    expect(isTimeRangeOrdered(start, end)).toBe(expected)
  })
})

describe('exceptionTimesAcceptable', () => {
  const cases: { start: string; end: string; expected: boolean }[] = [
    { start: '', end: '', expected: true },
    { start: '09:00', end: '17:00', expected: true },
    { start: '09:00', end: '', expected: false },
    { start: '', end: '17:00', expected: false },
    { start: '17:00', end: '09:00', expected: false },
  ]

  it.each(cases)('is $expected for "$start" to "$end"', ({ start, end, expected }) => {
    expect(exceptionTimesAcceptable(start, end)).toBe(expected)
  })
})

describe('availability mode copy', () => {
  it('labels the three modes without the word Traveler', () => {
    expect(modeLabel('traveler')).toBe('Home visits')
    expect(modeLabel('anywhere')).toBe('Home or office')
    expect(modeLabel('only_office')).toBe('Office only')
    expect(MODE_OPTIONS.some((option) => /traveler/i.test(option.label))).toBe(false)
  })

  it('returns the approved hint for each mode', () => {
    expect(modeHint('traveler')).toBe("The bot offers this slot only at the Child's home.")
    expect(modeHint('anywhere')).toBe(
      "The bot offers this slot at the Child's home or at the office.",
    )
    expect(modeHint('only_office')).toBe('The bot offers this slot only at the office.')
  })

  it('defaults a new slot to Home or office', () => {
    expect(DEFAULT_MODE).toBe('anywhere')
  })
})
