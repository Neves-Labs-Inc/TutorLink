import { formatTime } from '@/lib/dates/dates'
import type {
  Booking,
  BookingCounts,
  BookingKind,
  BookingListParams,
  BookingLocation,
} from '@/lib/queries/bookings'

export type BookingStatus = Booking['status']

// `kind` is the page's tab, not a filter: `''` is the All tab. `staffId` is the Staff member's
// user id (the API's `user_id`), so a Manager or an Admin can be picked as well as a Tutor.
export type BookingFilterState = {
  statuses: BookingStatus[]
  kind: '' | BookingKind
  staffId: string
  location: '' | BookingLocation
  subjectId: string
  childId: string
  from: string
  to: string
}

export type BookingKindTab = BookingFilterState['kind']

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

const KIND_OPTIONS: readonly BookingKind[] = ['regular', 'evaluation']
const LOCATION_OPTIONS: readonly BookingLocation[] = ['home', 'in_office']

export const EMPTY_FILTERS: BookingFilterState = {
  statuses: [],
  kind: '',
  staffId: '',
  location: '',
  subjectId: '',
  childId: '',
  from: '',
  to: '',
}

const STATUS_PARAM = 'status'
const KIND_PARAM = 'kind'
const STAFF_PARAM = 'user_id'
const LOCATION_PARAM = 'location'
const SUBJECT_PARAM = 'subject_id'
const CHILD_PARAM = 'child_id'
const FROM_PARAM = 'from'
const TO_PARAM = 'to'

export const bookingFiltersFromSearchParams = (search: URLSearchParams): BookingFilterState => {
  const statuses = search.getAll(STATUS_PARAM)

  return {
    statuses: STATUS_OPTIONS.filter((option) => statuses.includes(option)),
    kind: KIND_OPTIONS.find((option) => option === search.get(KIND_PARAM)) ?? '',
    staffId: search.get(STAFF_PARAM) ?? '',
    location: LOCATION_OPTIONS.find((option) => option === search.get(LOCATION_PARAM)) ?? '',
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
  if (state.kind !== '') {
    search.append(KIND_PARAM, state.kind)
  }
  if (state.staffId !== '') {
    search.append(STAFF_PARAM, state.staffId)
  }
  if (state.location !== '') {
    search.append(LOCATION_PARAM, state.location)
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
  if (state.kind !== '') {
    params.kind = state.kind
  }
  if (state.staffId !== '') {
    params.user_id = state.staffId
  }
  if (state.location !== '') {
    params.location = state.location
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
// The kind tab is not a control in the filter card, so it is left out.
export const activeFilterCount = (state: BookingFilterState): number =>
  state.statuses.length +
  [state.staffId, state.location, state.subjectId, state.childId, state.from, state.to].filter(
    (value) => value !== '',
  ).length

// Clear all empties the filter controls only: the kind tab stays where it is, and in calendar view
// the hidden From/To survive so switching back to List restores them.
export const clearedFilters = (
  state: BookingFilterState,
  { keepDateRange }: { keepDateRange: boolean },
): BookingFilterState => ({
  ...EMPTY_FILTERS,
  kind: state.kind,
  from: keepDateRange ? state.from : '',
  to: keepDateRange ? state.to : '',
})

export const kindTabCount = (kind: BookingKindTab, counts: BookingCounts): number =>
  kind === '' ? counts.regular + counts.evaluation : counts[kind]

const EMPTY_MESSAGES: Record<BookingKindTab, string> = {
  '': 'No bookings match these filters.',
  regular: 'No Regular bookings match these filters.',
  evaluation: 'No Evaluations match these filters.',
}

export const emptyBookingsMessage = (kind: BookingKindTab): string => EMPTY_MESSAGES[kind]

export const statusLabel = (status: BookingStatus): string => STATUS_LABELS[status]

export const bookingTimeLabel = (booking: BookingTimes): string =>
  `${formatTime(booking.start_time)} – ${formatTime(booking.end_time)}`

export const bookingCountLabel = (total: number): string =>
  total === 1 ? '1 booking' : `${total} bookings`
