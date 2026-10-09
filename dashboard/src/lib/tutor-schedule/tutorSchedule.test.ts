import { describe, it, expect } from 'vitest'

import { dayOfWeekFromIso } from '../availability/availability'
import {
  activeSlots,
  approvedOnDay,
  dayDateLabel,
  shiftWeek,
  slotBlocking,
  weekDaysIso,
  weekRangeLabel,
  weekStartIso,
} from './tutorSchedule'
import type { AvailabilitySlot } from '../queries/availability'
import type { TutorException } from '../queries/exceptions'

const slot = (overrides: Partial<AvailabilitySlot> = {}): AvailabilitySlot => ({
  id: 'slot-1',
  tutor_id: 'tutor-1',
  day_of_week: 0,
  start_time: '09:00:00',
  end_time: '11:00:00',
  is_active: true,
  mode: 'anywhere',
  ...overrides,
})

const exception = (overrides: Partial<TutorException> = {}): TutorException => ({
  id: 'exception-1',
  tutor_id: 'tutor-1',
  start_date: '2026-09-21',
  end_date: '2026-09-21',
  start_time: null,
  end_time: null,
  reason: 'vacation',
  notes: null,
  status: 'approved',
  created_at: '2026-09-01T10:00:00Z',
  ...overrides,
})

describe('weekStartIso', () => {
  // 2026-09-21 is a Monday and 2026-09-27 the Sunday that closes the same week.
  const cases: { name: string; iso: string; expected: string }[] = [
    { name: 'a Monday resolves to itself', iso: '2026-09-21', expected: '2026-09-21' },
    { name: 'a Tuesday steps back one day', iso: '2026-09-22', expected: '2026-09-21' },
    { name: 'a Saturday steps back five days', iso: '2026-09-26', expected: '2026-09-21' },
    {
      name: 'a Sunday belongs to the Monday six days behind it, not the one ahead',
      iso: '2026-09-27',
      expected: '2026-09-21',
    },
    { name: 'a week crossing a month', iso: '2026-10-01', expected: '2026-09-28' },
    { name: 'a week crossing a year', iso: '2027-01-01', expected: '2026-12-28' },
    { name: 'a week crossing a leap day', iso: '2024-03-01', expected: '2024-02-26' },
  ]

  it.each(cases)('$name', ({ iso, expected }) => {
    expect(weekStartIso(iso)).toBe(expected)
  })

  it('puts Sunday at the end of its week, where getDay() would start a new one', () => {
    // `Date.getDay()` reads 2026-09-27 as 0, which would make it its own week start.
    expect(new Date(2026, 8, 27).getDay()).toBe(0)
    expect(weekStartIso('2026-09-27')).not.toBe('2026-09-27')
    expect(weekDaysIso(weekStartIso('2026-09-27'))[6]).toBe('2026-09-27')
  })

  it('is idempotent', () => {
    expect(weekStartIso(weekStartIso('2026-09-24'))).toBe('2026-09-21')
  })
})

describe('weekDaysIso', () => {
  it('lists the seven dates of the week, Monday first', () => {
    expect(weekDaysIso('2026-09-21')).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
    ])
  })

  it('agrees index for index with day_of_week', () => {
    const days = weekDaysIso('2026-09-21')

    expect(days.map(dayOfWeekFromIso)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('holds across a month and a year boundary', () => {
    expect(weekDaysIso('2026-12-28')).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ])
  })
})

describe('weekRangeLabel', () => {
  const cases: { weekStart: string; expected: string }[] = [
    { weekStart: '2026-09-21', expected: '21 Sep 2026 – 27 Sep 2026' },
    { weekStart: '2026-09-28', expected: '28 Sep 2026 – 4 Oct 2026' },
    { weekStart: '2026-12-28', expected: '28 Dec 2026 – 3 Jan 2027' },
  ]

  it.each(cases)('labels the week of $weekStart', ({ weekStart, expected }) => {
    expect(weekRangeLabel(weekStart)).toBe(expected)
  })
})

describe('dayDateLabel', () => {
  const cases: { iso: string; expected: string }[] = [
    { iso: '2026-09-21', expected: '21 Sep' },
    { iso: '2026-10-04', expected: '4 Oct' },
  ]

  it.each(cases)('labels $iso as $expected', ({ iso, expected }) => {
    expect(dayDateLabel(iso)).toBe(expected)
  })
})

describe('shiftWeek', () => {
  const cases: { name: string; weekStart: string; weeks: number; expected: string }[] = [
    { name: 'forward one week', weekStart: '2026-09-21', weeks: 1, expected: '2026-09-28' },
    { name: 'backward one week', weekStart: '2026-09-21', weeks: -1, expected: '2026-09-14' },
    { name: 'no movement', weekStart: '2026-09-21', weeks: 0, expected: '2026-09-21' },
    { name: 'forward across a year', weekStart: '2026-12-28', weeks: 1, expected: '2027-01-04' },
    { name: 'backward across a year', weekStart: '2027-01-04', weeks: -2, expected: '2026-12-21' },
    { name: 'far forward, unbounded', weekStart: '2026-09-21', weeks: 60, expected: '2027-11-15' },
    { name: 'far backward, unbounded', weekStart: '2026-09-21', weeks: -60, expected: '2025-07-28' },
  ]

  it.each(cases)('shifts $name', ({ weekStart, weeks, expected }) => {
    expect(shiftWeek(weekStart, weeks)).toBe(expected)
  })

  it('always lands on a Monday', () => {
    expect(dayOfWeekFromIso(shiftWeek('2026-09-21', 37))).toBe(0)
    expect(dayOfWeekFromIso(shiftWeek('2026-09-21', -37))).toBe(0)
  })
})

describe('activeSlots', () => {
  it('drops a deactivated slot the availability endpoint still returns', () => {
    const live = slot({ id: 'live' })
    const withdrawn = slot({ id: 'withdrawn', is_active: false })

    expect(activeSlots([live, withdrawn])).toEqual([live])
  })

  it('keeps the order of the slots it keeps', () => {
    const rows = [slot({ id: 'a' }), slot({ id: 'b', is_active: false }), slot({ id: 'c' })]

    expect(activeSlots(rows).map((row) => row.id)).toEqual(['a', 'c'])
  })
})

describe('approvedOnDay', () => {
  const day = '2026-09-23'

  const cases: { name: string; overrides: Partial<TutorException>; expected: boolean }[] = [
    {
      name: 'a single-day approved row on the day',
      overrides: { start_date: day, end_date: day },
      expected: true,
    },
    {
      name: 'a row starting before the week and ending inside it',
      overrides: { start_date: '2026-09-14', end_date: day },
      expected: true,
    },
    {
      name: 'a row starting inside the week and ending after it',
      overrides: { start_date: day, end_date: '2026-10-05' },
      expected: true,
    },
    {
      name: 'a row spanning the whole week from both sides',
      overrides: { start_date: '2026-09-01', end_date: '2026-10-31' },
      expected: true,
    },
    {
      name: 'a row that ends the day before',
      overrides: { start_date: '2026-09-21', end_date: '2026-09-22' },
      expected: false,
    },
    {
      name: 'a row that starts the day after',
      overrides: { start_date: '2026-09-24', end_date: '2026-09-25' },
      expected: false,
    },
  ]

  it.each(cases)('$name is $expected', ({ overrides, expected }) => {
    expect(approvedOnDay(day, [exception(overrides)])).toHaveLength(expected ? 1 : 0)
  })

  it('drops a pending row that covers the day', () => {
    const pending = exception({ status: 'pending', start_date: day, end_date: day })

    expect(approvedOnDay(day, [pending])).toEqual([])
  })

  it('drops a rejected row that covers the day', () => {
    const rejected = exception({ status: 'rejected', start_date: day, end_date: day })

    expect(approvedOnDay(day, [rejected])).toEqual([])
  })

  it('keeps only the approved rows out of a mixed list', () => {
    const approved = exception({ id: 'approved', start_date: day, end_date: day })
    const pending = exception({ id: 'pending', status: 'pending', start_date: day, end_date: day })

    expect(approvedOnDay(day, [pending, approved]).map((row) => row.id)).toEqual(['approved'])
  })
})

describe('slotBlocking', () => {
  // The slot under test is 09:00–11:00 throughout.
  const cases: {
    name: string
    times: Pick<TutorException, 'start_time' | 'end_time'>
    expected: { state: string; label: string | null }
  }[] = [
    {
      name: 'an all-day absence blocks the slot outright',
      times: { start_time: null, end_time: null },
      expected: { state: 'blocked', label: 'Vacation' },
    },
    {
      name: 'a window matching the slot exactly blocks it',
      times: { start_time: '09:00:00', end_time: '11:00:00' },
      expected: { state: 'blocked', label: 'Vacation' },
    },
    {
      name: 'a window wider than the slot blocks it',
      times: { start_time: '08:00:00', end_time: '12:00:00' },
      expected: { state: 'blocked', label: 'Vacation' },
    },
    {
      name: 'a window overlapping the start blocks it partly',
      times: { start_time: '08:00:00', end_time: '10:00:00' },
      expected: { state: 'partly-blocked', label: 'Vacation, 8:00 AM – 10:00 AM' },
    },
    {
      name: 'a window overlapping the end blocks it partly',
      times: { start_time: '10:00:00', end_time: '12:00:00' },
      expected: { state: 'partly-blocked', label: 'Vacation, 10:00 AM – 12:00 PM' },
    },
    {
      name: 'a window inside the slot blocks it partly',
      times: { start_time: '09:30:00', end_time: '10:30:00' },
      expected: { state: 'partly-blocked', label: 'Vacation, 9:30 AM – 10:30 AM' },
    },
    {
      name: 'a window ending exactly when the slot starts leaves it clear',
      times: { start_time: '07:00:00', end_time: '09:00:00' },
      expected: { state: 'clear', label: null },
    },
    {
      name: 'a window starting exactly when the slot ends leaves it clear',
      times: { start_time: '11:00:00', end_time: '13:00:00' },
      expected: { state: 'clear', label: null },
    },
    {
      name: 'a window entirely before the slot leaves it clear',
      times: { start_time: '06:00:00', end_time: '07:00:00' },
      expected: { state: 'clear', label: null },
    },
    {
      name: 'a window entirely after the slot leaves it clear',
      times: { start_time: '13:00:00', end_time: '15:00:00' },
      expected: { state: 'clear', label: null },
    },
  ]

  it.each(cases)('$name', ({ times, expected }) => {
    expect(slotBlocking(slot(), [exception(times)])).toEqual(expected)
  })

  it('leaves a slot clear when no exception covers the day', () => {
    expect(slotBlocking(slot(), [])).toEqual({ state: 'clear', label: null })
  })

  it('lets a full block win over a partial one whatever the order', () => {
    const partial = exception({ id: 'partial', start_time: '09:00:00', end_time: '10:00:00' })
    const full = exception({ id: 'full', reason: 'sick' })

    expect(slotBlocking(slot(), [partial, full])).toEqual({ state: 'blocked', label: 'Sick' })
    expect(slotBlocking(slot(), [full, partial])).toEqual({ state: 'blocked', label: 'Sick' })
  })

  it('keeps the first partial block when two overlap the slot', () => {
    const morning = exception({ id: 'morning', start_time: '08:00:00', end_time: '10:00:00' })
    const later = exception({
      id: 'later',
      reason: 'personal',
      start_time: '10:30:00',
      end_time: '12:00:00',
    })

    expect(slotBlocking(slot(), [morning, later])).toEqual({
      state: 'partly-blocked',
      label: 'Vacation, 8:00 AM – 10:00 AM',
    })
  })

  it('ignores an exception that abuts the slot while another one blocks it', () => {
    const abutting = exception({ id: 'abutting', start_time: '07:00:00', end_time: '09:00:00' })
    const overlapping = exception({
      id: 'overlapping',
      reason: 'other',
      start_time: '10:00:00',
      end_time: '12:00:00',
    })

    expect(slotBlocking(slot(), [abutting, overlapping])).toEqual({
      state: 'partly-blocked',
      label: 'Other, 10:00 AM – 12:00 PM',
    })
  })

  it('applies a morning window to each day of its span rather than to the whole range', () => {
    const morningOff = exception({
      start_date: '2026-09-21',
      end_date: '2026-09-23',
      start_time: '09:00:00',
      end_time: '12:00:00',
    })
    const morning = slot({ start_time: '09:00:00', end_time: '11:00:00' })
    const afternoon = slot({ id: 'afternoon', start_time: '13:00:00', end_time: '15:00:00' })

    for (const dayIso of ['2026-09-21', '2026-09-22', '2026-09-23']) {
      const onDay = approvedOnDay(dayIso, [morningOff])

      expect(slotBlocking(morning, onDay).state).toBe('blocked')
      expect(slotBlocking(afternoon, onDay).state).toBe('clear')
    }

    expect(approvedOnDay('2026-09-24', [morningOff])).toEqual([])
  })

  it('falls back to the raw reason an unrecognised value carries', () => {
    const unknown = exception({ reason: 'sabbatical' })

    expect(slotBlocking(slot(), [unknown]).label).toBe('sabbatical')
  })
})
