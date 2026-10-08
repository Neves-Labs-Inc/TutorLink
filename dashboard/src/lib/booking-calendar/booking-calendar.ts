import { bookingListParams, type BookingFilterState } from '@/lib/bookings/bookings'
import type { Booking, BookingListParams } from '@/lib/queries/bookings'
import { weekDaysIso } from '@/lib/tutor-schedule/tutorSchedule'

export type BookingView = 'list' | 'calendar'

export type CalendarDay = { dayIso: string; bookings: Booking[] }

const VIEW_PARAM = 'view'
const SUNDAY_INDEX = 6

export const bookingViewFromSearchParams = (search: URLSearchParams): BookingView =>
  search.get(VIEW_PARAM) === 'calendar' ? 'calendar' : 'list'

// List is the default, so it is written as the absence of `view`: the list URL keeps the shape it
// had before the calendar existed, and bookmarks to it stay valid.
export const withBookingView = (search: URLSearchParams, view: BookingView): URLSearchParams => {
  const next = new URLSearchParams(search)

  if (view === 'calendar') {
    next.set(VIEW_PARAM, view)
  } else {
    next.delete(VIEW_PARAM)
  }

  return next
}

// The week replaces From/To, whatever the URL still holds for them: the hidden fields keep their
// values for the list view, but must not narrow the week being drawn.
export const calendarListParams = (
  filters: BookingFilterState,
  weekStart: string,
): BookingListParams => {
  const days = weekDaysIso(weekStart)

  return { ...bookingListParams(filters), from: days[0], to: days[SUNDAY_INDEX] }
}

// Times are `HH:MM:SS`, so they sort correctly as strings.
export const groupBookingsByDay = (bookings: Booking[], weekStart: string): CalendarDay[] =>
  weekDaysIso(weekStart).map((dayIso) => ({
    dayIso,
    bookings: bookings
      .filter((booking) => booking.scheduled_date === dayIso)
      .sort((left, right) => left.start_time.localeCompare(right.start_time)),
  }))

// Page numbers after the first one, for a total that the first page did not cover.
export const remainingPages = (total: number, pageSize: number): number[] => {
  const pageCount = Math.ceil(total / pageSize)

  return Array.from({ length: Math.max(pageCount - 1, 0) }, (_, index) => index + 2)
}
