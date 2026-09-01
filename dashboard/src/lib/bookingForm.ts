import { dayOfWeekFromIso } from '@/lib/availability'
import type { AvailabilitySlot } from '@/lib/queries/availability'
import type { BookingCreate } from '@/lib/queries/bookings'

export type BookingDraft = {
  clientId: string
  childId: string
  homeId: string
  tutorId: string
  subjectId: string
  date: string
  availabilityId: string
  startTime: string
  endTime: string
  notes: string
}

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
  clientId: '',
  childId: '',
  homeId: '',
  tutorId: '',
  subjectId: '',
  date: '',
  availabilityId: '',
  startTime: '',
  endTime: '',
  notes: '',
}

export const onClientChange = (draft: BookingDraft, clientId: string): BookingDraft => ({
  ...draft,
  clientId,
  childId: '',
  homeId: '',
})

export const onChildChange = (draft: BookingDraft, childId: string): BookingDraft => ({
  ...draft,
  childId,
})

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

  if (draft.clientId === '') {
    errors.push('Choose a client.')
  }
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

const inputTime = (hms: string): string => hms.slice(0, 5)
