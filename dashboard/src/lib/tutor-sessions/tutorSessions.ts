import { addDaysIso, formatIsoDate } from '@/lib/dates/dates'
import type { Booking, BookingListParams } from '@/lib/queries/bookings'

export type SessionTab = 'upcoming' | 'past'

export type SessionFilterState = {
  tab: SessionTab
  from: string
  to: string
  q: string
}

export type SessionWindow = { from?: string; to?: string }

export const EMPTY_SESSION_FILTERS: SessionFilterState = {
  tab: 'upcoming',
  from: '',
  to: '',
  q: '',
}

const TAB_PARAM = 'tab'
const FROM_PARAM = 'from'
const TO_PARAM = 'to'
const QUERY_PARAM = 'q'

// `GET /api/bookings` orders `scheduled_date` ascending with no way to reverse it, so an unbounded
// Past tab would open on the tutor's oldest sessions ever. The window below is a default filter
// value the tutor can widen or clear, not a floor — and it is calendar-derived rather than a
// "last N days" constant, because an arbitrary constant here would have to become an admin-editable
// `system_settings` row (decision P6-G).
export const defaultWindow = (tab: SessionTab, todayIso: string): SessionWindow => {
  let window: SessionWindow = { from: todayIso }

  if (tab === 'past') {
    const yesterday = addDaysIso(todayIso, -1)
    const firstOfMonth = firstOfMonthIso(todayIso)

    // On the 1st the first of the month is already later than yesterday. Sending that pair
    // verbatim would ask for `from > to` — an empty window, and a sentence on screen running
    // forwards from a later date to an earlier one — so the default is yesterday alone.
    window = { from: firstOfMonth <= yesterday ? firstOfMonth : yesterday, to: yesterday }
  }

  return window
}

// No `tutor_id` is ever sent (decision P6-H): `GET /api/bookings` takes `TutorScope`, which scopes
// a tutor to themself and refuses a cross-tutor id with 403 before the route body runs. No `status`
// is sent either — a cancelled future session must stay visible somewhere, and the status column is
// the only signal a tutor gets (divergence D-P6-1).
export const sessionListParams = (
  state: SessionFilterState,
  todayIso: string,
): BookingListParams => {
  const params: BookingListParams = {}
  const window = sessionWindow(state, todayIso)

  if (window.from !== undefined) {
    params.from = window.from
  }
  if (window.to !== undefined) {
    params.to = window.to
  }

  return params
}

export const windowLabel = (params: BookingListParams): string => {
  let label = 'All sessions'

  if (params.from !== undefined && params.to !== undefined) {
    label = `Sessions from ${formatIsoDate(params.from)} to ${formatIsoDate(params.to)}`
  } else if (params.from !== undefined) {
    label = `Sessions from ${formatIsoDate(params.from)} onwards`
  } else if (params.to !== undefined) {
    label = `Sessions up to ${formatIsoDate(params.to)}`
  }

  return label
}

// `GET /api/bookings` has no `?q=`, so this narrows the page already held (OQ-18, REQ-052.6's
// precedent). `searchHintLabel` is what stops that reading as a search of the whole history.
export const filterByChildName = (items: Booking[], q: string): Booking[] => {
  const term = q.trim().toLowerCase()

  return term === ''
    ? items
    : items.filter((booking) => booking.child.name.toLowerCase().includes(term))
}

export const searchHintLabel = (shown: number, held: number): string =>
  `${shown} of ${held} ${held === 1 ? 'session' : 'sessions'} on this page ` +
  `${shown === 1 ? 'matches' : 'match'}`

export const sessionFiltersFromSearchParams = (search: URLSearchParams): SessionFilterState => ({
  tab: search.get(TAB_PARAM) === 'past' ? 'past' : 'upcoming',
  from: search.get(FROM_PARAM) ?? '',
  to: search.get(TO_PARAM) ?? '',
  q: search.get(QUERY_PARAM) ?? '',
})

export const sessionFilterSearchParams = (state: SessionFilterState): URLSearchParams => {
  const search = new URLSearchParams()

  if (state.tab !== 'upcoming') {
    search.append(TAB_PARAM, state.tab)
  }
  if (state.from !== '') {
    search.append(FROM_PARAM, state.from)
  }
  if (state.to !== '') {
    search.append(TO_PARAM, state.to)
  }
  if (state.q !== '') {
    search.append(QUERY_PARAM, state.q)
  }

  return search
}

// An untouched pair takes the tab's default window. Once either end is set the state is
// authoritative, so clearing the other end really widens the window instead of snapping back to
// the default — which is what keeps "past sessions: unbounded, paginated" reachable. Whichever
// window this produces is the one `windowLabel` prints on screen.
const sessionWindow = (state: SessionFilterState, todayIso: string): SessionWindow => {
  let window = defaultWindow(state.tab, todayIso)

  if (state.from !== '' || state.to !== '') {
    window = {}

    if (state.from !== '') {
      window.from = state.from
    }
    if (state.to !== '') {
      window.to = state.to
    }
  }

  return window
}

// String surgery, not a `Date`: `scheduled_date` is a bare business-local date, and routing it
// through a `Date` is how a window silently shifts a day at a timezone boundary.
const firstOfMonthIso = (iso: string): string => `${iso.slice(0, 8)}01`
