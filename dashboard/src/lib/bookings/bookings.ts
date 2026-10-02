import { formatTime } from '@/lib/dates/dates'
import type { Booking, BookingListParams } from '@/lib/queries/bookings'

export type BookingStatus = Booking['status']

export type BookingFilterState = {
  statuses: BookingStatus[]
  tutorId: string
  subjectId: string
  childId: string
  from: string
  to: string
}

export type BookingTimes = Pick<Booking, 'start_time' | 'end_time'>

const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  completed: 'Completed',
}

export const STATUS_OPTIONS: readonly BookingStatus[] = [
  'pending',
  'confirmed',
  'cancelled',
  'completed',
]

export const EMPTY_FILTERS: BookingFilterState = {
  statuses: [],
  tutorId: '',
  subjectId: '',
  childId: '',
  from: '',
  to: '',
}

const STATUS_PARAM = 'status'
const TUTOR_PARAM = 'tutor_id'
const SUBJECT_PARAM = 'subject_id'
const CHILD_PARAM = 'child_id'
const FROM_PARAM = 'from'
const TO_PARAM = 'to'

export const bookingFiltersFromSearchParams = (search: URLSearchParams): BookingFilterState => {
  const statuses = search.getAll(STATUS_PARAM)

  return {
    statuses: STATUS_OPTIONS.filter((option) => statuses.includes(option)),
    tutorId: search.get(TUTOR_PARAM) ?? '',
    subjectId: search.get(SUBJECT_PARAM) ?? '',
    childId: search.get(CHILD_PARAM) ?? '',
    from: search.get(FROM_PARAM) ?? '',
    to: search.get(TO_PARAM) ?? '',
  }
}

// One `append` per status keeps the browser URL in the repeated form `?status=a&status=b`, the only
// form FastAPI reads — it ignores the bracketed `status[]=` without complaint
// (`lib/queries/bookings.ts:92-96`), so a bracketed link would filter nothing while claiming to.
export const bookingFilterSearchParams = (state: BookingFilterState): URLSearchParams => {
  const search = new URLSearchParams()

  for (const status of state.statuses) {
    search.append(STATUS_PARAM, status)
  }
  if (state.tutorId !== '') {
    search.append(TUTOR_PARAM, state.tutorId)
  }
  if (state.subjectId !== '') {
    search.append(SUBJECT_PARAM, state.subjectId)
  }
  if (state.childId !== '') {
    search.append(CHILD_PARAM, state.childId)
  }
  if (state.from !== '') {
    search.append(FROM_PARAM, state.from)
  }
  if (state.to !== '') {
    search.append(TO_PARAM, state.to)
  }

  return search
}

// No selected status omits `status` altogether, which returns every status
// (`docs/api-design.md:1077`) — not the same request as naming all four.
export const bookingListParams = (state: BookingFilterState): BookingListParams => {
  const params: BookingListParams = {}

  if (state.statuses.length > 0) {
    params.status = [...state.statuses]
  }
  if (state.tutorId !== '') {
    params.tutor_id = state.tutorId
  }
  if (state.subjectId !== '') {
    params.subject_id = state.subjectId
  }
  if (state.childId !== '') {
    params.child_id = state.childId
  }
  if (state.from !== '') {
    params.from = state.from
  }
  if (state.to !== '') {
    params.to = state.to
  }

  return params
}

export const toggleStatus = (
  statuses: BookingStatus[],
  status: BookingStatus,
): BookingStatus[] => {
  const next = statuses.includes(status)
    ? statuses.filter((current) => current !== status)
    : [...statuses, status]

  return STATUS_OPTIONS.filter((option) => next.includes(option))
}

// Each status counts on its own, and so do from and to: the badge mirrors how many controls are set.
export const activeFilterCount = (state: BookingFilterState): number =>
  state.statuses.length +
  [state.tutorId, state.subjectId, state.childId, state.from, state.to].filter(
    (value) => value !== '',
  ).length

export const statusLabel = (status: BookingStatus): string => STATUS_LABELS[status]

export const bookingTimeLabel = (booking: BookingTimes): string =>
  `${formatTime(booking.start_time)} – ${formatTime(booking.end_time)}`

export const bookingCountLabel = (total: number): string =>
  total === 1 ? '1 booking' : `${total} bookings`
