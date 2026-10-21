import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import {
  BOOKING_QUERY_KEY,
  bookingSearchParams,
  type BookingListParams,
  type BookingPage,
  type BookingSummary,
} from '@/lib/queries/bookings'
import type { Page } from '@/lib/queries/page'

// A Tutor's own Sessions (`GET /api/bookings` scopes a Tutor to their own). The list is sorted
// soonest first with no way to reverse it, so Past pages are cut from the end of that order.

export const PAST_SESSIONS_PAGE_SIZE = 25

// The API's page cap: Upcoming shows what one page of it holds.
export const UPCOMING_SESSIONS_LIMIT = 100

const SESSIONS_QUERY_KEY = [...BOOKING_QUERY_KEY, 'list', 'sessions'] as const

const fetchPage = async (params: BookingListParams): Promise<BookingPage> => {
  const response = await api.get<BookingPage>(`/api/bookings?${bookingSearchParams(params)}`)

  return response.data
}

// Page `page` of the Sessions up to `lastDay`, most recent first. Soonest-first index range
// [start, end) holds it; it spans at most two of the API's pages of the same size.
const fetchMostRecentFirst = async (
  lastDay: string,
  page: number,
): Promise<Page<BookingSummary>> => {
  const pageSize = PAST_SESSIONS_PAGE_SIZE
  const first = await fetchPage({ to: lastDay, page: 1, page_size: pageSize })
  const end = first.total - (page - 1) * pageSize
  const start = Math.max(0, end - pageSize)
  const firstApiPage = Math.floor(start / pageSize) + 1
  const lastApiPage = Math.floor((end - 1) / pageSize) + 1
  const apiPages =
    end <= 0
      ? []
      : await Promise.all(
          Array.from({ length: lastApiPage - firstApiPage + 1 }, (_, index) => firstApiPage + index).map(
            (apiPage) =>
              apiPage === 1
                ? first
                : fetchPage({ to: lastDay, page: apiPage, page_size: pageSize }),
          ),
        )
  const offset = (firstApiPage - 1) * pageSize
  const items = apiPages
    .flatMap((apiPage) => apiPage.items)
    .slice(start - offset, end - offset)
    .reverse()

  return { items, total: first.total, page, page_size: pageSize }
}

export const sessionQueries = {
  // From `today` on, soonest first, every status.
  upcoming: (today: string) =>
    queryOptions({
      queryKey: [...SESSIONS_QUERY_KEY, 'upcoming', today],
      queryFn: () => fetchPage({ from: today, page: 1, page_size: UPCOMING_SESSIONS_LIMIT }),
    }),

  // Up to and including `lastDay`, most recent first; the previous page stays while the next loads.
  past: (lastDay: string, page: number) =>
    queryOptions({
      queryKey: [...SESSIONS_QUERY_KEY, 'past', lastDay, page],
      queryFn: () => fetchMostRecentFirst(lastDay, page),
      placeholderData: keepPreviousData,
    }),
}
