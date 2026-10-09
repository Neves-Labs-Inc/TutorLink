import { describe, it, expect } from 'vitest'
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { warningsOf } from '../api'
import {
  childPickerOptions,
  draftErrors,
  draftFromDetail,
  EMPTY_DRAFT,
  homeOptionsFor,
  IN_OFFICE,
  onChildChange,
  onChildDetail,
  onDateChange,
  onKindChange,
  onSlotChange,
  onStaffChange,
  slotModeWarning,
  slotsForDate,
  staffOptionsFor,
  submitLabel,
  submitPlan,
  timeSource,
  toCreateBody,
  toUpdateBody,
  weekdayName,
  type BookingDraft,
} from './bookingForm'
import type { AvailabilitySlot } from '../queries/availability'
import type { BookingDetail } from '../queries/bookings'
import type { ChildDetail, ChildHome, ChildSummary } from '../queries/children'
import type { Staff } from '../queries/staff'

const ORDER_ERROR = 'End time must be after start time.'

const staff = (overrides: Partial<Staff> = {}): Staff => ({
  id: 'user-1',
  name: 'Tina Tutor',
  role: 'tutor',
  tutor_id: 'tutor-1',
  ...overrides,
})

const slot = (overrides: Partial<AvailabilitySlot> = {}): AvailabilitySlot => ({
  id: 'slot-1',
  tutor_id: 'tutor-1',
  day_of_week: 0,
  start_time: '09:00:00',
  end_time: '10:30:00',
  is_active: true,
  mode: 'anywhere',
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
  levels: [],
  evaluated: null,
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
  evaluated: null,
  created_at: '2026-09-28T12:00:00Z',
  ...overrides,
})

const bookingDetail = (overrides: Partial<BookingDetail> = {}): BookingDetail => ({
  id: 'booking-1',
  child: { id: 'child-1', name: 'Tommy Doe', notes: null },
  staff: { id: 'user-1', name: 'Tina Tutor', role: 'tutor' },
  kind: 'regular',
  location: 'home',
  subject: { id: 'subject-1', name: 'Maths' },
  scheduled_date: '2026-09-02',
  start_time: '09:00:00',
  end_time: '10:00:00',
  status: 'confirmed',
  notes: 'bring the workbook',
  updated_at: '2026-09-01T12:00:00Z',
  home: { id: 'home-1', label: null, address: '1 Main St', access_code: '1234' },
  booked_by_guardian: null,
  ...overrides,
})

const filled: BookingDraft = {
  mode: 'create',
  kind: 'regular',
  childId: 'child-1',
  childInactive: false,
  staffId: 'user-1',
  staffRole: 'tutor',
  staffTutorId: 'tutor-1',
  location: 'home-1',
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
  it('always clears the location when the child changes, because its homes load afterwards', () => {
    expect(onChildChange(filled, { id: 'child-2' })).toMatchObject({
      childId: 'child-2',
      location: '',
    })
  })

  it('clears the child and the location when the child is cleared', () => {
    expect(onChildChange({ ...filled, childInactive: true }, null)).toMatchObject({
      childId: '',
      childInactive: false,
      location: '',
    })
  })

  it.each([
    { name: 'an inactive option', inactive: true, expected: true },
    { name: 'an active option', inactive: false, expected: false },
    { name: 'an option with no status', inactive: undefined, expected: false },
  ])('remembers the status of $name', ({ inactive, expected }) => {
    expect(onChildChange(filled, { id: 'child-2', inactive }).childInactive).toBe(expected)
  })

  it('leaves the staff side untouched when the child changes', () => {
    expect(onChildChange(filled, { id: 'child-2' })).toMatchObject({
      staffId: 'user-1',
      subjectId: 'subject-1',
      availabilityId: 'slot-1',
      startTime: '09:00',
      endTime: '10:00',
    })
  })

  it('takes the id, role and profile of the chosen staff member', () => {
    const admin = staff({ id: 'user-9', role: 'admin', tutor_id: null })

    expect(onStaffChange(filled, admin)).toMatchObject({
      staffId: 'user-9',
      staffRole: 'admin',
      staffTutorId: null,
    })
  })

  it('clears the slot and the times when the staff member changes', () => {
    expect(onStaffChange(filled, staff({ id: 'user-2', tutor_id: 'tutor-2' }))).toMatchObject({
      staffId: 'user-2',
      staffTutorId: 'tutor-2',
      availabilityId: '',
      startTime: '',
      endTime: '',
    })
  })

  it('clears the staff member, the slot and the times when the staff is deselected', () => {
    expect(onStaffChange(filled, null)).toMatchObject({
      staffId: '',
      staffRole: '',
      staffTutorId: null,
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
      location: 'home-1',
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
    onStaffChange(filled, staff({ id: 'user-2' }))
    onDateChange(filled, '2026-09-03')
    onSlotChange(filled, null)
    onKindChange(filled, 'evaluation', { childEvaluable: false })

    expect(filled).toEqual(before)
  })
})

describe('timeSource', () => {
  it.each([
    { kind: 'evaluation', staffRole: 'tutor', expected: 'typed' },
    { kind: 'evaluation', staffRole: 'manager', expected: 'typed' },
    { kind: 'evaluation', staffRole: 'admin', expected: 'typed' },
    { kind: 'evaluation', staffRole: '', expected: 'typed' },
    { kind: 'regular', staffRole: 'admin', expected: 'typed' },
    { kind: 'regular', staffRole: '', expected: 'typed' },
    { kind: 'regular', staffRole: 'tutor', expected: 'slot' },
    { kind: 'regular', staffRole: 'manager', expected: 'slot' },
  ] as const)('is $expected for $kind with $staffRole', ({ kind, staffRole, expected }) => {
    expect(timeSource(kind, staffRole)).toBe(expected)
  })
})

describe('onKindChange', () => {
  const evaluable = { childEvaluable: true }

  it('clears the child when it cannot be given an Evaluation', () => {
    const draft = { ...filled, childInactive: true }

    expect(onKindChange(draft, 'evaluation', { childEvaluable: false })).toMatchObject({
      kind: 'evaluation',
      childId: '',
      childInactive: false,
    })
  })

  it('keeps an evaluable child', () => {
    expect(onKindChange(filled, 'evaluation', evaluable)).toMatchObject({ childId: 'child-1' })
  })

  it('clears a Tutor, who cannot give an Evaluation', () => {
    expect(onKindChange(filled, 'evaluation', evaluable)).toMatchObject({
      staffId: '',
      staffRole: '',
      staffTutorId: null,
    })
  })

  it.each(['manager', 'admin'] as const)('keeps a %s', (staffRole) => {
    const draft = { ...filled, staffRole, staffTutorId: null }

    expect(onKindChange(draft, 'evaluation', evaluable)).toMatchObject({
      staffId: 'user-1',
      staffRole,
    })
  })

  it('clears the subject and the slot, which an Evaluation has none of', () => {
    expect(onKindChange(filled, 'evaluation', evaluable)).toMatchObject({
      subjectId: '',
      availabilityId: '',
    })
  })

  it('keeps the date, the times, the location and the notes', () => {
    const draft = { ...filled, notes: 'bring the workbook' }

    expect(onKindChange(draft, 'evaluation', { childEvaluable: false })).toMatchObject({
      date: '2026-09-02',
      startTime: '09:00',
      endTime: '10:00',
      location: 'home-1',
      notes: 'bring the workbook',
    })
  })

  it('clears a Manager with no teaching profile when switching back to Regular', () => {
    const draft = { ...filled, kind: 'evaluation' as const, staffRole: 'manager' as const, staffTutorId: null }

    expect(onKindChange(draft, 'regular', evaluable)).toMatchObject({
      kind: 'regular',
      staffId: '',
      staffRole: '',
      staffTutorId: null,
      childId: 'child-1',
    })
  })

  it('keeps everything when switching back to Regular', () => {
    const draft = { ...filled, kind: 'evaluation' as const, staffRole: 'admin' as const }

    expect(onKindChange(draft, 'regular', { childEvaluable: false })).toEqual({
      ...draft,
      kind: 'regular',
    })
  })
})

describe('staffOptionsFor', () => {
  const members = [
    staff({ id: 'tutor', role: 'tutor' }),
    staff({ id: 'teaching-manager', role: 'manager', tutor_id: 'tutor-2' }),
    staff({ id: 'desk-manager', role: 'manager', tutor_id: null }),
    staff({ id: 'admin', role: 'admin', tutor_id: null }),
  ]

  it('offers Tutors, teaching Managers and Admins for a Regular booking', () => {
    expect(staffOptionsFor(members, 'regular').map((member) => member.id)).toEqual([
      'tutor',
      'teaching-manager',
      'admin',
    ])
  })

  it('offers every Manager and Admin, and no Tutor, for an Evaluation', () => {
    expect(staffOptionsFor(members, 'evaluation').map((member) => member.id)).toEqual([
      'teaching-manager',
      'desk-manager',
      'admin',
    ])
  })
})

describe('slotModeWarning', () => {
  it('warns when a home-visits slot is booked In office', () => {
    expect(slotModeWarning(slot({ mode: 'traveler' }), IN_OFFICE)).toBe(
      'This slot is for home visits only; the bot would not offer it at the office.',
    )
  })

  it('warns when an office-only slot is booked at a home', () => {
    expect(slotModeWarning(slot({ mode: 'only_office' }), 'home-1')).toBe(
      'This slot is for the office only; the bot would not offer it at a home.',
    )
  })

  it.each([
    { name: 'a home-or-office slot In office', mode: 'anywhere', location: IN_OFFICE },
    { name: 'a home-or-office slot at a home', mode: 'anywhere', location: 'home-1' },
    { name: 'a home-visits slot at a home', mode: 'traveler', location: 'home-1' },
    { name: 'an office-only slot In office', mode: 'only_office', location: IN_OFFICE },
    { name: 'a slot with no location yet', mode: 'only_office', location: '' },
  ] as const)('says nothing for $name', ({ mode, location }) => {
    expect(slotModeWarning(slot({ mode }), location)).toBeNull()
  })

  it('says nothing when no slot is chosen', () => {
    expect(slotModeWarning(undefined, IN_OFFICE)).toBeNull()
  })
})

describe('submitLabel', () => {
  const cases: {
    name: string
    inactive: boolean
    hasWarnings: boolean
    busy: boolean
    expected: string
  }[] = [
    { name: 'a plain create', inactive: false, hasWarnings: false, busy: false, expected: 'Create booking' },
    { name: 'shown warnings', inactive: false, hasWarnings: true, busy: false, expected: 'Book anyway' },
    { name: 'an inactive child', inactive: true, hasWarnings: false, busy: false, expected: 'Reactivate and book' },
    { name: 'warnings on an inactive child', inactive: true, hasWarnings: true, busy: false, expected: 'Book anyway' },
    { name: 'a create in flight', inactive: false, hasWarnings: true, busy: true, expected: 'Creating…' },
    { name: 'a reactivation in flight', inactive: true, hasWarnings: false, busy: true, expected: 'Reactivating…' },
  ]

  it.each(cases)('reads "$expected" for $name', ({ inactive, hasWarnings, busy, expected }) => {
    expect(submitLabel({ ...filled, childInactive: inactive }, hasWarnings, busy)).toBe(expected)
  })
})

describe('draftErrors', () => {
  const required: { field: keyof BookingDraft; message: string }[] = [
    { field: 'childId', message: 'Choose a child.' },
    { field: 'staffId', message: 'Choose a staff member.' },
    { field: 'location', message: 'Choose a location.' },
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
    // No slot error: with no staff member chosen the times are typed.
    expect(draftErrors(EMPTY_DRAFT)).toHaveLength(required.length - 1)
  })

  it('does not ask for a slot when the times are typed', () => {
    const draft = { ...filled, staffRole: 'admin' as const, availabilityId: '' }

    expect(draftErrors(draft)).toEqual([])
  })

  it('does not ask for a subject or a slot on an Evaluation', () => {
    const draft = { ...filled, kind: 'evaluation' as const, subjectId: '', availabilityId: '' }

    expect(draftErrors(draft)).toEqual([])
  })

  it('accepts In office as a location', () => {
    expect(draftErrors({ ...filled, location: IN_OFFICE })).toEqual([])
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

  it('accepts notes at the limit', () => {
    expect(draftErrors({ ...filled, notes: 'x'.repeat(255) })).toEqual([])
  })

  it('refuses notes over the limit, which the API would bounce', () => {
    expect(draftErrors({ ...filled, notes: 'x'.repeat(256) })).toEqual([
      'Notes cannot be longer than 255 characters.',
    ])
  })

  it('measures the notes as sent, trimmed', () => {
    expect(draftErrors({ ...filled, notes: `  ${'x'.repeat(255)}  ` })).toEqual([])
  })

  it('does not guess at any server rule', () => {
    expect(draftErrors({ ...filled, date: '1999-01-01' })).toEqual([])
  })
})

describe('toCreateBody', () => {
  it('sends a Regular booking at a home as the endpoint reads it', () => {
    expect(toCreateBody(filled, [])).toEqual({
      child_id: 'child-1',
      kind: 'regular',
      user_id: 'user-1',
      location: 'home',
      home_id: 'home-1',
      subject_id: 'subject-1',
      availability_id: 'slot-1',
      scheduled_date: '2026-09-02',
      start_time: '09:00',
      end_time: '10:00',
      confirm_warnings: [],
    })
  })

  it('sends In office with no home', () => {
    expect(toCreateBody({ ...filled, location: IN_OFFICE }, [])).toMatchObject({
      location: 'in_office',
      home_id: null,
    })
  })

  it('sends an Evaluation with no subject and no slot', () => {
    const draft = { ...filled, kind: 'evaluation' as const, staffRole: 'admin' as const }

    expect(toCreateBody(draft, [])).toMatchObject({
      kind: 'evaluation',
      subject_id: null,
      availability_id: null,
    })
  })

  it('sends no slot for an Admin, who has no availability', () => {
    expect(toCreateBody({ ...filled, staffRole: 'admin' }, [])).toMatchObject({
      availability_id: null,
    })
  })

  it('carries the confirmed warnings', () => {
    expect(toCreateBody(filled, ['outside_slot', 'gap'])).toMatchObject({
      confirm_warnings: ['outside_slot', 'gap'],
    })
  })

  it('never carries the child status', () => {
    expect(toCreateBody({ ...filled, childInactive: true }, [])).not.toHaveProperty('is_active')
  })

  it('never carries booked_by_guardian_id', () => {
    expect(toCreateBody(filled, [])).not.toHaveProperty('booked_by_guardian_id')
  })

  it.each(['', '   ', '\n'])('omits blank notes (%j)', (notes) => {
    expect(toCreateBody({ ...filled, notes }, [])).not.toHaveProperty('notes')
  })

  it('trims notes that carry text', () => {
    expect(toCreateBody({ ...filled, notes: '  bring the workbook  ' }, [])).toMatchObject({
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
      evaluable: true,
    })
  })

  it('marks an inactive child as inactive', () => {
    expect(childPickerOptions([], inactive)[0]).toEqual({
      id: 'i1',
      label: 'Bea',
      description: 'Grade 4 · inactive',
      inactive: true,
      evaluable: true,
    })
  })

  it('marks an Evaluated child as not evaluable', () => {
    const evaluated = childSummary({
      evaluated: { at: '2026-09-01T10:00:00Z', by: { id: 'user-1', name: 'Mia' } },
    })

    expect(childPickerOptions([evaluated], [])[0].evaluable).toBe(false)
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

describe('warningsOf', () => {
  const refusal = (status: number, data: unknown): AxiosError => {
    const config = {} as InternalAxiosRequestConfig
    const response = { status, data, statusText: '', headers: {}, config } as AxiosResponse

    return new AxiosError('Request failed', String(status), config, undefined, response)
  }

  it('returns the warnings of a confirmable 409', () => {
    const warnings = [{ code: 'outside_slot', message: 'That time is not inside the slot' }]

    expect(warningsOf(refusal(409, { detail: 'Needs confirming', warnings }))).toEqual(warnings)
  })

  it('returns null for a block that carries only a detail', () => {
    expect(warningsOf(refusal(409, { detail: 'That Staff member already has a booking' }))).toBeNull()
  })

  it('returns null for an error that is not a response', () => {
    expect(warningsOf(new Error('offline'))).toBeNull()
  })
})

describe('draftFromDetail', () => {
  const staffList = [staff(), staff({ id: 'user-2', name: 'Mia Manager', role: 'manager', tutor_id: null })]

  it('prefills an edit of a Regular booking at a home, leaving the slot to be picked again', () => {
    expect(draftFromDetail(bookingDetail(), staffList)).toEqual({
      mode: 'edit',
      kind: 'regular',
      childId: 'child-1',
      childInactive: false,
      staffId: 'user-1',
      staffRole: 'tutor',
      staffTutorId: 'tutor-1',
      location: 'home-1',
      subjectId: 'subject-1',
      date: '2026-09-02',
      availabilityId: '',
      startTime: '09:00',
      endTime: '10:00',
      notes: 'bring the workbook',
    })
  })

  it('prefills an edit of an In office Evaluation', () => {
    const detail = bookingDetail({
      kind: 'evaluation',
      location: 'in_office',
      home: null,
      subject: null,
      staff: { id: 'user-2', name: 'Mia Manager', role: 'manager' },
      notes: null,
    })

    expect(draftFromDetail(detail, staffList)).toMatchObject({
      mode: 'edit',
      kind: 'evaluation',
      staffId: 'user-2',
      staffRole: 'manager',
      staffTutorId: null,
      location: IN_OFFICE,
      subjectId: '',
      notes: '',
    })
  })

  it('has no teaching profile for a staff member missing from the list', () => {
    expect(draftFromDetail(bookingDetail(), []).staffTutorId).toBeNull()
  })
})

describe('edit mode', () => {
  const editing: BookingDraft = { ...filled, mode: 'edit' }

  it('keeps the kind locked', () => {
    expect(onKindChange(editing, 'evaluation', { childEvaluable: true })).toBe(editing)
  })

  it('never reactivates the child', () => {
    expect(submitPlan({ ...editing, childInactive: true })).toBe('book')
  })

  it('keeps the booking times when the slot is picked again', () => {
    expect(onSlotChange(editing, slot({ start_time: '08:00:00', end_time: '12:00:00' }))).toMatchObject({
      availabilityId: 'slot-1',
      startTime: '09:00',
      endTime: '10:00',
    })
  })

  it('takes the slot bounds once the times were cleared by a date change', () => {
    const afterDate = onDateChange(editing, '2026-09-09')

    expect(onSlotChange(afterDate, slot({ start_time: '08:00:00', end_time: '12:00:00' }))).toMatchObject({
      startTime: '08:00',
      endTime: '12:00',
    })
  })

  const labels: { name: string; hasWarnings: boolean; busy: boolean; expected: string }[] = [
    { name: 'a plain save', hasWarnings: false, busy: false, expected: 'Save changes' },
    { name: 'shown warnings', hasWarnings: true, busy: false, expected: 'Save anyway' },
    { name: 'a save in flight', hasWarnings: true, busy: true, expected: 'Saving…' },
  ]

  it.each(labels)('labels the submit for $name', ({ hasWarnings, busy, expected }) => {
    expect(submitLabel(editing, hasWarnings, busy)).toBe(expected)
  })
})

describe('toUpdateBody', () => {
  const editing: BookingDraft = { ...filled, mode: 'edit', notes: 'changed' }

  it('sends the replacement as the endpoint reads it', () => {
    expect(toUpdateBody(editing, ['outside_slot'])).toEqual({
      notes: 'changed',
      kind: 'regular',
      user_id: 'user-1',
      location: 'home',
      home_id: 'home-1',
      subject_id: 'subject-1',
      availability_id: 'slot-1',
      scheduled_date: '2026-09-02',
      start_time: '09:00',
      end_time: '10:00',
      confirm_warnings: ['outside_slot'],
    })
  })

  it.each(['child_id', 'booked_by_guardian_id'])('never carries %s, which the endpoint refuses', (key) => {
    expect(toUpdateBody(editing, [])).not.toHaveProperty(key)
  })

  it('trims notes that carry text', () => {
    expect(toUpdateBody({ ...editing, notes: '  skip chapter 3  ' }, [])).toMatchObject({
      notes: 'skip chapter 3',
    })
  })

  it.each(['', '   ', '\n'])('clears blank notes (%j) with null, which the endpoint reads as cleared', (notes) => {
    expect(toUpdateBody({ ...editing, notes }, [])).toMatchObject({ notes: null })
  })

  it('sends In office with no home', () => {
    expect(toUpdateBody({ ...editing, location: IN_OFFICE }, [])).toMatchObject({
      location: 'in_office',
      home_id: null,
    })
  })

  it('sends an Evaluation with no subject and no slot', () => {
    const draft = { ...editing, kind: 'evaluation' as const, staffRole: 'manager' as const }

    expect(toUpdateBody(draft, [])).toMatchObject({
      kind: 'evaluation',
      subject_id: null,
      availability_id: null,
    })
  })

  it('sends no slot for an Admin, who has no availability', () => {
    expect(toUpdateBody({ ...editing, staffRole: 'admin' }, [])).toMatchObject({
      availability_id: null,
    })
  })
})
