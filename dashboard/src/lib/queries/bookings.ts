import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { remainingPages } from '@/lib/booking-calendar/booking-calendar'
import { DEFAULT_PAGE_SIZE, type Page } from '@/lib/queries/page'

export type NamedRef = { id: string; name: string }

export type Booking = {
  id: string
  child: NamedRef
  tutor: NamedRef
  subject: NamedRef
  scheduled_date: string
  start_time: string
  end_time: string
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed'
  notes: string | null
}

export type BookingChild = NamedRef & { notes: string | null }

export type BookingDetail = Omit<Booking, 'child'> & {
  child: BookingChild
  home: { id: string; label: string | null; address: string; access_code: string }
  booked_by_guardian: NamedRef | null
}

export type BookingListParams = {
  status?: Booking['status'][]
  tutor_id?: string
  subject_id?: string
  child_id?: string
  from?: string
  to?: string
  page?: number
  page_size?: number
}

export type BookingWeekParams = Omit<BookingListParams, 'page' | 'page_size'>

export type BookingWeek = { items: Booking[]; total: number }

export type BookingCreate = {
  child_id: string
  tutor_id: string
  subject_id: string
  availability_id: string
  home_id: string
  scheduled_date: string
  start_time: string
  end_time: string
  notes?: string | null
}

export type BookingWriteResult = {
  id: string
  status: Booking['status']
  scheduled_date: string
  start_time: string
  end_time: string
}

// The API caps `page_size` at 100 (`api/app/schemas/common.py`).
const MAX_PAGE_SIZE = 100

const fetchBookingPage = async (params: BookingListParams): Promise<Page<Booking>> => {
  const response = await api.get<Page<Booking>>(`/api/bookings?${bookingSearchParams(params)}`)

  return response.data
}

export const bookingQueries = {
  list: (params: BookingListParams = {}) =>
    queryOptions({
      queryKey: ['bookings', 'list', params],
      queryFn: () => fetchBookingPage(params),
      placeholderData: keepPreviousData,
    }),

  // Every booking in the window, however many pages it spans. Shares the `['bookings', 'list']`
  // prefix so the invalidations that refresh the list refresh the calendar too. No placeholder
  // data: a new week shows its skeleton rather than the previous week's entries under its heading.
  week: (params: BookingWeekParams) =>
    queryOptions({
      queryKey: ['bookings', 'list', 'week', params],
      queryFn: async (): Promise<BookingWeek> => {
        const first = await fetchBookingPage({ ...params, page: 1, page_size: MAX_PAGE_SIZE })
        const rest = await Promise.all(
          remainingPages(first.total, MAX_PAGE_SIZE).map((page) =>
            fetchBookingPage({ ...params, page, page_size: MAX_PAGE_SIZE }),
          ),
        )

        return { items: [first, ...rest].flatMap((page) => page.items), total: first.total }
      },
    }),

  detail: (bookingId: string) =>
    queryOptions({
      queryKey: ['bookings', 'detail', bookingId],
      queryFn: async () => {
        const response = await api.get<BookingDetail>(`/api/bookings/${bookingId}`)

        return response.data
      },
    }),
}

export const createBooking = async (data: BookingCreate): Promise<BookingWriteResult> => {
  const response = await api.post<BookingWriteResult>('/api/bookings', data)

  return response.data
}

export const updateBookingStatus = async (
  bookingId: string,
  status: Booking['status'],
): Promise<BookingWriteResult> => {
  const response = await api.patch<BookingWriteResult>(`/api/bookings/${bookingId}`, { status })

  return response.data
}

// Axios's default array serialiser turns `status: ['pending', 'confirmed']` into
// `status[]=pending&status[]=confirmed`, which FastAPI silently ignores rather than rejects —
// the request succeeds and the filter does nothing. `docs/api-design.md:1077` requires the
// repeated form, `?status=pending&status=confirmed`, so the query string is built by hand here
// and shared by every caller that lists bookings, rather than left to axios's `params` option.
export const bookingSearchParams = (params: BookingListParams): string => {
  const search = new URLSearchParams()

  for (const status of params.status ?? []) {
    search.append('status', status)
  }
  if (params.tutor_id !== undefined) {
    search.append('tutor_id', params.tutor_id)
  }
  if (params.subject_id !== undefined) {
    search.append('subject_id', params.subject_id)
  }
  if (params.child_id !== undefined) {
    search.append('child_id', params.child_id)
  }
  if (params.from !== undefined) {
    search.append('from', params.from)
  }
  if (params.to !== undefined) {
    search.append('to', params.to)
  }
  search.append('page', String(params.page ?? 1))
  search.append('page_size', String(params.page_size ?? DEFAULT_PAGE_SIZE))

  return search.toString()
}
