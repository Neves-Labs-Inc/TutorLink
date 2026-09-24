import { describe, it, expect } from 'vitest'
import {
  childPickerOptions,
  draftErrors,
  EMPTY_DRAFT,
  homeOptionsFor,
  onChildChange,
  onChildDetail,
  onDateChange,
  onSlotChange,
  onTutorChange,
  slotsForDate,
  submitPlan,
  toCreateBody,
  weekdayName,
  type BookingDraft,
} from './bookingForm'
import type { AvailabilitySlot } from '../queries/availability'
import type { ChildDetail, ChildHome, ChildSummary } from '../queries/children'

const ORDER_ERROR = 'The end time must be after the start time.'

const slot = (overrides: Partial<AvailabilitySlot> = {}): AvailabilitySlot => ({
  id: 'slot-1',
  tutor_id: 'tutor-1',
  day_of_week: 0,
  start_time: '09:00:00',
  end_time: '10:30:00',
  is_active: true,
  ...overrides,
})

const home = (overrides: Partial<ChildHome> = {}): ChildHome => ({
  id: 'home-1',
  label: null,
  address: '1 Main St',
  access_code: '1234',
  is_active: true,
  ...overrides,
})

const childDetail = (overrides: Partial<ChildDetail> = {}): ChildDetail => ({
  id: 'child-1',
  name: 'Tommy Doe',
  date_of_birth: '2014-05-02',
  grade_level: 7,
  school_name: 'Lincoln Middle School',
  notes: null,
  is_active: true,
  upcoming_session_count: 0,
  guardians: [],
  homes: [home()],
  ...overrides,
})

const childSummary = (overrides: Partial<ChildSummary> = {}): ChildSummary => ({
  id: 'child-1',
  name: 'Tommy Doe',
  grade_level: 7,
  school_name: 'Lincoln Middle School',
  is_active: true,
  guardians: [],
  homes: [],
  next_session: null,
  ...overrides,
})

const filled: BookingDraft = {
  childId: 'child-1',
  childInactive: false,
  homeId: 'home-1',
  tutorId: 'tutor-1',
  subjectId: 'subject-1',
  date: '2026-09-02',
  availabilityId: 'slot-1',
  startTime: '09:00',
  endTime: '10:00',
  notes: '',
}

describe('slotsForDate', () => {
  const weekdays: { isoDate: string; name: string; dayOfWeek: number }[] = [
    { isoDate: '2026-08-31', name: 'Monday', dayOfWeek: 0 },
    { isoDate: '2026-09-01', name: 'Tuesday', dayOfWeek: 1 },
    { isoDate: '2026-09-02', name: 'Wednesday', dayOfWeek: 2 },
    { isoDate: '2026-09-03', name: 'Thursday', dayOfWeek: 3 },
    { isoDate: '2026-09-04', name: 'Friday', dayOfWeek: 4 },
    { isoDate: '2026-09-05', name: 'Saturday', dayOfWeek: 5 },
    { isoDate: '2026-09-06', name: 'Sunday', dayOfWeek: 6 },
  ]

  const everyDay = weekdays.map((weekday) =>
    slot({ id: `slot-${weekday.dayOfWeek}`, day_of_week: weekday.dayOfWeek }),
  )

  it.each(weekdays)('offers only the $name slot for $isoDate', ({ isoDate, dayOfWeek }) => {
    expect(slotsForDate(everyDay, isoDate).map((match) => match.day_of_week)).toEqual([dayOfWeek])
  })

  it.each(weekdays)('names $isoDate as $name', ({ isoDate, name }) => {
    expect(weekdayName(isoDate)).toBe(name)
  })

  it('excludes an inactive slot on the matching weekday', () => {
    const slots = [
      slot({ id: 'active', day_of_week: 6 }),
      slot({ id: 'withdrawn', day_of_week: 6, is_active: false }),
    ]

    expect(slotsForDate(slots, '2026-09-06').map((match) => match.id)).toEqual(['active'])
  })

  it('returns nothing when no date has been chosen', () => {
    expect(slotsForDate([slot()], '')).toEqual([])
  })

  it('returns nothing when the tutor has no slot on that weekday', () => {
    expect(slotsForDate([slot({ day_of_week: 0 })], '2026-09-03')).toEqual([])
  })
})

describe('cascade reducers', () => {
  it('always clears the home when the child changes, because its homes load afterwards', () => {
    expect(onChildChange(filled, { id: 'child-2' })).toMatchObject({
      childId: 'child-2',
      homeId: '',
    })
  })

  it('clears the child and the home when the child is cleared', () => {
    expect(onChildChange({ ...filled, childInactive: true }, null)).toMatchObject({
      childId: '',
      childInactive: false,
      homeId: '',
    })
  })

  it.each([
    { name: 'an inactive option', inactive: true, expected: true },
    { name: 'an active option', inactive: false, expected: false },
    { name: 'an option with no status', inactive: undefined, expected: false },
  ])('remembers the status of $name', ({ inactive, expected }) => {
    expect(onChildChange(filled, { id: 'child-2', inactive }).childInactive).toBe(expected)
  })

  it('leaves the tutor side untouched when the child changes', () => {
    expect(onChildChange(filled, { id: 'child-2' })).toMatchObject({
      tutorId: 'tutor-1',
      subjectId: 'subject-1',
      availabilityId: 'slot-1',
      startTime: '09:00',
      endTime: '10:00',
    })
  })

  it('clears the slot and the times when the tutor changes', () => {
    expect(onTutorChange(filled, 'tutor-2')).toMatchObject({
      tutorId: 'tutor-2',
      availabilityId: '',
      startTime: '',
      endTime: '',
    })
  })

  it('clears the slot and the times when the date changes', () => {
    expect(onDateChange(filled, '2026-09-03')).toMatchObject({
      date: '2026-09-03',
      availabilityId: '',
      startTime: '',
      endTime: '',
    })
  })

  it('leaves the child side untouched when the date changes', () => {
    expect(onDateChange(filled, '2026-09-03')).toMatchObject({
      childId: 'child-1',
      homeId: 'home-1',
    })
  })

  it('defaults the times to the slot bounds', () => {
    expect(onSlotChange(EMPTY_DRAFT, slot({ id: 'slot-9' }))).toMatchObject({
      availabilityId: 'slot-9',
      startTime: '09:00',
      endTime: '10:30',
    })
  })

  it('clears the slot and the times when the slot is deselected', () => {
    expect(onSlotChange(filled, null)).toMatchObject({
      availabilityId: '',
      startTime: '',
      endTime: '',
    })
  })

  it('does not mutate the draft it is given', () => {
    const before = { ...filled }
    onChildChange(filled, { id: 'child-2', inactive: true })
    onChildDetail(filled, childDetail({ is_active: false }))
    onTutorChange(filled, 'tutor-2')
    onDateChange(filled, '2026-09-03')
    onSlotChange(filled, null)

    expect(filled).toEqual(before)
  })
})

describe('draftErrors', () => {
  const required: { field: keyof BookingDraft; message: string }[] = [
    { field: 'childId', message: 'Choose a child.' },
    { field: 'homeId', message: 'Choose a home.' },
    { field: 'tutorId', message: 'Choose a tutor.' },
    { field: 'subjectId', message: 'Choose a subject.' },
    { field: 'date', message: 'Choose a date.' },
    { field: 'availabilityId', message: 'Choose an availability slot.' },
    { field: 'startTime', message: 'Enter a start time.' },
    { field: 'endTime', message: 'Enter an end time.' },
  ]

  it('reports nothing for a complete draft', () => {
    expect(draftErrors(filled)).toEqual([])
  })

  it.each(required)('reports a missing $field', ({ field, message }) => {
    expect(draftErrors({ ...filled, [field]: '' })).toEqual([message])
  })

  it('reports every missing selection at once', () => {
    expect(draftErrors(EMPTY_DRAFT)).toHaveLength(required.length)
  })

  const ordering: { name: string; startTime: string; endTime: string; expected: string[] }[] = [
    { name: 'an end before the start', startTime: '10:00', endTime: '09:00', expected: [ORDER_ERROR] },
    { name: 'an end equal to the start', startTime: '10:00', endTime: '10:00', expected: [ORDER_ERROR] },
    { name: 'an end after the start', startTime: '09:00', endTime: '09:15', expected: [] },
    { name: 'a range crossing noon', startTime: '09:00', endTime: '13:00', expected: [] },
  ]

  it.each(ordering)('reports $name', ({ startTime, endTime, expected }) => {
    expect(draftErrors({ ...filled, startTime, endTime })).toEqual(expected)
  })

  it('never asks for a client', () => {
    expect(draftErrors(EMPTY_DRAFT).join(' ')).not.toMatch(/client/i)
  })

  it('does not refuse an inactive child, because the form reactivates it first', () => {
    expect(draftErrors({ ...filled, childInactive: true })).toEqual([])
  })

  it('does not guess at any server rule', () => {
    expect(draftErrors({ ...filled, date: '1999-01-01' })).toEqual([])
  })
})

describe('toCreateBody', () => {
  it('sends the ids the endpoint requires and no guardian', () => {
    expect(toCreateBody(filled)).toEqual({
      child_id: 'child-1',
      tutor_id: 'tutor-1',
      subject_id: 'subject-1',
      availability_id: 'slot-1',
      home_id: 'home-1',
      scheduled_date: '2026-09-02',
      start_time: '09:00',
      end_time: '10:00',
    })
  })

  it('never carries the child status', () => {
    expect(toCreateBody({ ...filled, childInactive: true })).not.toHaveProperty('is_active')
  })

  it('never carries booked_by_guardian_id', () => {
    expect(toCreateBody(filled)).not.toHaveProperty('booked_by_guardian_id')
  })

  it.each(['', '   ', '\n'])('omits blank notes (%j)', (notes) => {
    expect(toCreateBody({ ...filled, notes })).not.toHaveProperty('notes')
  })

  it('trims notes that carry text', () => {
    expect(toCreateBody({ ...filled, notes: '  bring the workbook  ' })).toMatchObject({
      notes: 'bring the workbook',
    })
  })
})

describe('onChildDetail', () => {
  it('marks the chosen child inactive when its detail says so', () => {
    expect(onChildDetail(filled, childDetail({ is_active: false })).childInactive).toBe(true)
  })

  it('marks the chosen child active when its detail says so', () => {
    const draft = { ...filled, childInactive: true }

    expect(onChildDetail(draft, childDetail({ is_active: true })).childInactive).toBe(false)
  })

  it('ignores the detail of a child that is no longer chosen', () => {
    const draft = { ...filled, childId: 'child-2' }

    expect(onChildDetail(draft, childDetail({ is_active: false }))).toBe(draft)
  })
})

describe('homeOptionsFor', () => {
  it('offers nothing before a child is chosen or its detail has loaded', () => {
    expect(homeOptionsFor(undefined)).toEqual([])
  })

  it('offers only the active homes', () => {
    const detail = childDetail({
      homes: [home({ id: 'active' }), home({ id: 'withdrawn', is_active: false })],
    })

    expect(homeOptionsFor(detail).map((option) => option.id)).toEqual(['active'])
  })

  it('offers every linked home, the co-parent’s included, in API order', () => {
    const detail = childDetail({
      homes: [home({ id: 'dads', label: 'Dad’s' }), home({ id: 'mums', label: 'Mum’s' })],
    })

    expect(homeOptionsFor(detail).map((option) => option.id)).toEqual(['dads', 'mums'])
  })

  it('offers nothing when the child has no active home', () => {
    expect(homeOptionsFor(childDetail({ homes: [home({ is_active: false })] }))).toEqual([])
  })
})

describe('childPickerOptions', () => {
  const active = [
    childSummary({ id: 'a1', name: 'Amy', grade_level: 3 }),
    childSummary({ id: 'a2', name: 'Zed', grade_level: 5 }),
  ]
  const inactive = [childSummary({ id: 'i1', name: 'Bea', grade_level: 4, is_active: false })]

  it('lists the active children before the inactive ones, each in API order', () => {
    expect(childPickerOptions(active, inactive).map((option) => option.id)).toEqual([
      'a1',
      'a2',
      'i1',
    ])
  })

  it('labels an active child with its name and grade', () => {
    expect(childPickerOptions(active, [])[0]).toEqual({
      id: 'a1',
      label: 'Amy',
      description: 'Grade 3',
      inactive: false,
    })
  })

  it('marks an inactive child as inactive', () => {
    expect(childPickerOptions([], inactive)[0]).toEqual({
      id: 'i1',
      label: 'Bea',
      description: 'Grade 4 · inactive',
      inactive: true,
    })
  })

  it('returns nothing when neither search matched', () => {
    expect(childPickerOptions([], [])).toEqual([])
  })
})

describe('submitPlan', () => {
  it('reactivates first when the chosen child is inactive', () => {
    expect(submitPlan({ ...filled, childInactive: true })).toBe('reactivate-then-book')
  })

  it('books directly when the chosen child is active', () => {
    expect(submitPlan(filled)).toBe('book')
  })

  it('books directly once a reactivated child has been marked active', () => {
    const reactivated = onChildDetail({ ...filled, childInactive: true }, childDetail())

    expect(submitPlan(reactivated)).toBe('book')
  })
})
