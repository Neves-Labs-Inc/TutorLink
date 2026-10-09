import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { remainingPages } from '@/lib/booking-calendar/booking-calendar'
import { DEFAULT_PAGE_SIZE, type Page } from '@/lib/queries/page'

export type NamedRef = { id: string; name: string }

export type StaffRole = 'tutor' | 'manager' | 'admin'

// The Staff member a Booking is with; `id` is the user's id, not a tutor profile id.
export type StaffRef = { id: string; name: string; role: StaffRole }

export type BookingKind = 'regular' | 'evaluation'

export type BookingLocation = 'home' | 'in_office'

export type Booking = {
  id: string
  child: NamedRef
  staff: StaffRef
  kind: BookingKind
  location: BookingLocation
  // Null on an Evaluation.
  subject: NamedRef | null
  scheduled_date: string
  start_time: string
  end_time: string
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed'
  notes: string | null
  updated_at: string
}

export type BookingChild = NamedRef & { notes: string | null }

export type BookingDetail = Omit<Booking, 'child'> & {
  child: BookingChild
  // Null when the session is In office.
  home: { id: string; label: string | null; address: string; access_code: string } | null
  booked_by_guardian: NamedRef | null
}

export type BookingListParams = {
  status?: Booking['status'][]
  kind?: BookingKind
  location?: BookingLocation
  // The Staff member's user id. `tutor_id` is the older tutor-profile filter.
  user_id?: string
  tutor_id?: string
  subject_id?: string
  child_id?: string
  from?: string
  to?: string
  page?: number
  page_size?: number
}

export type BookingWeekParams = Omit<BookingListParams, 'page' | 'page_size'>

export type BookingCounts = { regular: number; evaluation: number }

// `counts_by_kind` is optional until the API sends it (ticket 03).
export type BookingPage = Page<Booking> & { counts_by_kind?: BookingCounts }

// `counts_by_kind` is the shown week's, from its first page, so the kind tabs can count it.
export type BookingWeek = { items: Booking[]; total: number; counts_by_kind?: BookingCounts }

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

const fetchBookingPage = async (params: BookingListParams): Promise<BookingPage> => {
  const response = await api.get<BookingPage>(`/api/bookings?${bookingSearchParams(params)}`)

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

        return {
          items: [first, ...rest].flatMap((page) => page.items),
          total: first.total,
          counts_by_kind: first.counts_by_kind,
        }
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
  if (params.kind !== undefined) {
    search.append('kind', params.kind)
  }
  if (params.location !== undefined) {
    search.append('location', params.location)
  }
  if (params.user_id !== undefined) {
    search.append('user_id', params.user_id)
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
