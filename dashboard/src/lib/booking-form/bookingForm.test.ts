import { describe, it, expect } from 'vitest'
import {
  draftErrors,
  EMPTY_DRAFT,
  onChildChange,
  onClientChange,
  onDateChange,
  onSlotChange,
  onTutorChange,
  slotsForDate,
  toCreateBody,
  weekdayName,
  type BookingDraft,
} from './bookingForm'
import type { AvailabilitySlot } from '../queries/availability'

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

const filled: BookingDraft = {
  clientId: 'client-1',
  childId: 'child-1',
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
  it('clears the child and the home when the client changes', () => {
    expect(onClientChange(filled, 'client-2')).toMatchObject({
      clientId: 'client-2',
      childId: '',
      homeId: '',
    })
  })

  it('keeps the home when the child changes, because the homes come from the client', () => {
    expect(onChildChange(filled, 'child-2')).toMatchObject({
      childId: 'child-2',
      homeId: 'home-1',
    })
  })

  it('leaves the tutor side untouched when the child changes', () => {
    expect(onChildChange(filled, 'child-2')).toMatchObject({
      clientId: 'client-1',
      tutorId: 'tutor-1',
      availabilityId: 'slot-1',
    })
  })

  it('leaves the tutor side untouched when the client changes', () => {
    expect(onClientChange(filled, 'client-2')).toMatchObject({
      tutorId: 'tutor-1',
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

  it('leaves the client side untouched when the date changes', () => {
    expect(onDateChange(filled, '2026-09-03')).toMatchObject({
      clientId: 'client-1',
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
    onClientChange(filled, 'client-2')
    onChildChange(filled, 'child-2')
    onTutorChange(filled, 'tutor-2')
    onDateChange(filled, '2026-09-03')
    onSlotChange(filled, null)

    expect(filled).toEqual(before)
  })
})

describe('draftErrors', () => {
  const required: { field: keyof BookingDraft; message: string }[] = [
    { field: 'clientId', message: 'Choose a client.' },
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

  it('never carries booked_by_guardian_id even when the client is known', () => {
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
