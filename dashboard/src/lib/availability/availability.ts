import { addDaysIso, DAY_LABELS, formatIsoDate, formatTime } from '@/lib/dates/dates'
import type { AvailabilitySlot } from '@/lib/queries/availability'
import type { ExceptionReason, TutorException } from '@/lib/queries/exceptions'

export type ExceptionWindow = Pick<
  TutorException,
  'start_date' | 'end_date' | 'start_time' | 'end_time'
>

const DAYS_IN_WEEK = 7

export const EXCEPTION_REASONS: { value: ExceptionReason; label: string }[] = [
  { value: 'vacation', label: 'Vacation' },
  { value: 'personal', label: 'Personal' },
  { value: 'sick', label: 'Sick' },
  { value: 'other', label: 'Other' },
]

export const byDayOfWeek = (slots: AvailabilitySlot[]): AvailabilitySlot[][] => {
  const days: AvailabilitySlot[][] = Array.from({ length: DAYS_IN_WEEK }, () => [])

  for (const slot of slots) {
    days[slot.day_of_week].push(slot)
  }

  return days.map((day) => [...day].sort(compareByStartTime))
}

export const slotRangeLabel = (slot: AvailabilitySlot): string =>
  `${formatTime(slot.start_time)} – ${formatTime(slot.end_time)}`

export const exceptionWindowLabel = (window: ExceptionWindow): string => {
  const dates = dateRangeLabel(window.start_date, window.end_date)
  let label: string

  if (window.start_time === null || window.end_time === null) {
    label = `${dates}, all day`
  } else {
    const hours = `${formatTime(window.start_time)} – ${formatTime(window.end_time)}`
    const perDay = window.start_date === window.end_date ? '' : ' each day'

    label = `${dates}, ${hours}${perDay}`
  }

  return label
}

export const exceptionPreviewLabel = (window: ExceptionWindow): string =>
  `Blocks ${exceptionWindowLabel(window)} — ${weekdaysInRange(window.start_date, window.end_date).join(', ')}.`

export const exceptionReasonLabel = (reason: string): string =>
  EXCEPTION_REASONS.find((entry) => entry.value === reason)?.label ?? reason

export const isDecidable = (exception: TutorException): boolean => exception.status === 'pending'

// `Date.getDay()` is 0 = Sunday, `tutor_availability.day_of_week` is 0 = Monday. Every conversion
// between the two goes through here: reading a slot off the wrong index offers Tuesday's hours on
// a Wednesday, and nothing in the system reports that as an error.
export const dayOfWeekFromIso = (iso: string): number => {
  const [year, month, day] = iso.split('-').map(Number)
  const sundayFirst = new Date(Date.UTC(year, month - 1, day)).getUTCDay()

  return (sundayFirst + 6) % DAYS_IN_WEEK
}

export const weekdaysInRange = (startIso: string, endIso: string): string[] => {
  const labels: string[] = []
  let iso = startIso

  while (iso <= endIso && labels.length < DAYS_IN_WEEK) {
    const label = DAY_LABELS[dayOfWeekFromIso(iso)]

    if (!labels.includes(label)) {
      labels.push(label)
    }
    iso = addDaysIso(iso, 1)
  }

  return labels
}

export const timeInputValue = (hms: string | null): string => (hms === null ? '' : hms.slice(0, 5))

export const isTimeRangeOrdered = (start: string, end: string): boolean =>
  start !== '' && end !== '' && end > start

// Both set or both omitted: `ck_tutor_availability_exceptions_time_pair` and the Pydantic
// validator mirroring it refuse a half-set pair with a 400.
export const exceptionTimesAcceptable = (start: string, end: string): boolean =>
  (start === '' && end === '') || isTimeRangeOrdered(start, end)

const compareByStartTime = (left: AvailabilitySlot, right: AvailabilitySlot): number =>
  left.start_time.localeCompare(right.start_time)

const dateRangeLabel = (startIso: string, endIso: string): string => {
  const start = monthDayLabel(startIso)
  const end = monthDayLabel(endIso)
  let label: string

  if (startIso === endIso) {
    label = start
  } else if (startIso.slice(0, 7) === endIso.slice(0, 7)) {
    label = `${start.split(' ')[0]}–${end}`
  } else {
    label = `${start} – ${end}`
  }

  return label
}

const monthDayLabel = (iso: string): string => formatIsoDate(iso).split(' ').slice(0, 2).join(' ')
