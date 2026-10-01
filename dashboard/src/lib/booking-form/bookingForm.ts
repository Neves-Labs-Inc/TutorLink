import { dayOfWeekFromIso } from '@/lib/availability/availability'
import { gradeLabel } from '@/lib/children/children'
import type { AvailabilitySlot } from '@/lib/queries/availability'
import type { BookingCreate } from '@/lib/queries/bookings'
import type { ChildDetail, ChildHome, ChildSummary } from '@/lib/queries/children'

export type BookingDraft = {
  childId: string
  childInactive: boolean
  homeId: string
  tutorId: string
  subjectId: string
  date: string
  availabilityId: string
  startTime: string
  endTime: string
  notes: string
}

export type ChildPickerOption = {
  id: string
  label: string
  description: string
  inactive: boolean
}

export type ChildChoice = {
  id: string
  inactive?: boolean
}

export type SubmitPlan = 'book' | 'reactivate-then-book'

const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]

export const EMPTY_DRAFT: BookingDraft = {
  childId: '',
  childInactive: false,
  homeId: '',
  tutorId: '',
  subjectId: '',
  date: '',
  availabilityId: '',
  startTime: '',
  endTime: '',
  notes: '',
}

export const onChildChange = (draft: BookingDraft, child: ChildChoice | null): BookingDraft => ({
  ...draft,
  childId: child === null ? '' : child.id,
  childInactive: child?.inactive === true,
  homeId: '',
})

export const onChildDetail = (draft: BookingDraft, detail: ChildDetail): BookingDraft =>
  detail.id === draft.childId ? { ...draft, childInactive: !detail.is_active } : draft

export const childPickerOption = (
  child: Pick<ChildSummary, 'id' | 'name' | 'grade_level'>,
  inactive: boolean,
): ChildPickerOption => ({
  id: child.id,
  label: child.name,
  description: inactive ? `${gradeLabel(child.grade_level)} · inactive` : gradeLabel(child.grade_level),
  inactive,
})

export const childPickerOptions = (
  active: ChildSummary[],
  inactive: ChildSummary[],
): ChildPickerOption[] => [
  ...active.map((child) => childPickerOption(child, false)),
  ...inactive.map((child) => childPickerOption(child, true)),
]

export const homeOptionsFor = (detail: ChildDetail | undefined): ChildHome[] =>
  detail === undefined ? [] : detail.homes.filter((home) => home.is_active)

export const submitPlan = (draft: BookingDraft): SubmitPlan =>
  draft.childInactive ? 'reactivate-then-book' : 'book'

export const onTutorChange = (draft: BookingDraft, tutorId: string): BookingDraft => ({
  ...draft,
  tutorId,
  availabilityId: '',
  startTime: '',
  endTime: '',
})

export const onDateChange = (draft: BookingDraft, date: string): BookingDraft => ({
  ...draft,
  date,
  availabilityId: '',
  startTime: '',
  endTime: '',
})

export const onSlotChange = (
  draft: BookingDraft,
  slot: AvailabilitySlot | null,
): BookingDraft => ({
  ...draft,
  availabilityId: slot === null ? '' : slot.id,
  startTime: slot === null ? '' : inputTime(slot.start_time),
  endTime: slot === null ? '' : inputTime(slot.end_time),
})

export const slotsForDate = (slots: AvailabilitySlot[], isoDate: string): AvailabilitySlot[] => {
  const weekday = dayOfWeekFromIso(isoDate)

  return slots.filter((slot) => slot.is_active && slot.day_of_week === weekday)
}

export const weekdayName = (isoDate: string): string => WEEKDAY_NAMES[dayOfWeekFromIso(isoDate)]

export const draftErrors = (draft: BookingDraft): string[] => {
  const errors: string[] = []

  if (draft.childId === '') {
    errors.push('Choose a child.')
  }
  if (draft.homeId === '') {
    errors.push('Choose a home.')
  }
  if (draft.tutorId === '') {
    errors.push('Choose a tutor.')
  }
  if (draft.subjectId === '') {
    errors.push('Choose a subject.')
  }
  if (draft.date === '') {
    errors.push('Choose a date.')
  }
  if (draft.availabilityId === '') {
    errors.push('Choose an availability slot.')
  }
  if (draft.startTime === '') {
    errors.push('Enter a start time.')
  }
  if (draft.endTime === '') {
    errors.push('Enter an end time.')
  }
  if (draft.startTime !== '' && draft.endTime !== '' && draft.endTime <= draft.startTime) {
    errors.push('The end time must be after the start time.')
  }

  return errors
}

export const toCreateBody = (draft: BookingDraft): BookingCreate => {
  const notes = draft.notes.trim()
  const body: BookingCreate = {
    child_id: draft.childId,
    tutor_id: draft.tutorId,
    subject_id: draft.subjectId,
    availability_id: draft.availabilityId,
    home_id: draft.homeId,
    scheduled_date: draft.date,
    start_time: draft.startTime,
    end_time: draft.endTime,
  }

  if (notes !== '') {
    body.notes = notes
  }

  return body
}

export const inputTime = (hms: string): string => hms.slice(0, 5)
