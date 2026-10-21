import { queryOptions } from '@tanstack/react-query'
import { api, errorStatus } from '@/lib/api'
import type { Page } from '@/lib/queries/page'

// A Booking's Staff member is one of these; a Developer is never bookable.
export type StaffRole = 'tutor' | 'manager' | 'admin'

export type Staff = {
  id: string
  name: string
  role: StaffRole
  // The teaching profile (`GET /api/tutors/{tutor_id}/availability` takes it); null for an
  // Admin or a Manager with no profile.
  tutor_id: string | null
}

// The API caps a page at 100; the Office is far smaller, so one page is the whole list.
const STAFF_PAGE_SIZE = 100

// A malformed id is refused as 400 (validation) and an unknown one as 404: neither is there.
export const isStaffMissing = (error: unknown): boolean => {
  const status = errorStatus(error)

  return status === 400 || status === 404
}

const DETAIL_RETRIES = 1

export const staffQueries = {
  list: () =>
    queryOptions({
      queryKey: ['staff', 'list'],
      queryFn: async () => {
        const response = await api.get<Page<Staff>>('/api/staff', {
          params: { page_size: STAFF_PAGE_SIZE },
        })

        return response.data
      },
    }),

  // Staff who can be booked: everyone not archived, with their Subjects.
  active: () =>
    queryOptions({
      queryKey: ['staff', 'list', { archived: false }],
      queryFn: async () => {
        const response = await api.get<Page<StaffRead>>('/api/staff', {
          params: { archived: false, page_size: STAFF_PAGE_SIZE },
        })

        return response.data
      },
    }),
}

// The Staff screen's row (`api/app/schemas/staff.py`). `id` is the user id; a Developer is never
// listed.
export type SignInStateWire = 'not_invited' | 'invited' | 'active'

export type StaffSubject = { id: string; name: string; max_grade_level: number }

export type AssignedChild = { id: string; name: string }

export type StaffRead = Staff & {
  email: string
  sign_in_state: SignInStateWire
  invite_expires_at: string | null
  archived: boolean
  subjects: StaffSubject[]
  sessions_this_week: number
  assigned_children: AssignedChild[]
  phone_number: string | null
  bio: string | null
  has_pending_time_off: boolean
}

export type StaffListParams = {
  archived: boolean
  roles: StaffRole[]
  signInStates: SignInStateWire[]
  q: string
}

// FastAPI reads a repeated key (`role=tutor&role=admin`); axios's default array form is
// `role[]=`, so the params go as URLSearchParams.
function toSearchParams(params: StaffListParams): URLSearchParams {
  const search = new URLSearchParams({
    archived: String(params.archived),
    page_size: String(STAFF_PAGE_SIZE),
  })
  for (const role of params.roles) search.append('role', role)
  for (const state of params.signInStates) search.append('sign_in_state', state)
  const q = params.q.trim()
  if (q !== '') search.set('q', q)
  return search
}

export const staffDirectoryQueries = {
  list: (params: StaffListParams) =>
    queryOptions({
      queryKey: ['staff', 'directory', params] as const,
      queryFn: async () => {
        const response = await api.get<Page<StaffRead>>('/api/staff', {
          params: toSearchParams(params),
        })

        return response.data
      },
      // Keeps rows up while a search narrows them, but never shows one tab's rows under the other.
      placeholderData: (previous, previousQuery) =>
        previousQuery?.queryKey[2].archived === params.archived ? previous : undefined,
    }),

  // A tab's total for its count; one row is the smallest page the API serves.
  count: (archived: boolean) =>
    queryOptions({
      queryKey: ['staff', 'count', archived],
      queryFn: async () => {
        const response = await api.get<Page<StaffRead>>('/api/staff', {
          params: { archived, page_size: 1 },
        })

        return response.data.total
      },
    }),

  detail: (staffId: string) =>
    queryOptions({
      queryKey: ['staff', 'detail', staffId],
      queryFn: async () => {
        const response = await api.get<StaffRead>(`/api/staff/${encodeURIComponent(staffId)}`)

        return response.data
      },
      // A missing member won't appear on a second ask; anything else gets the app's one retry.
      retry: (failureCount, error) => !isStaffMissing(error) && failureCount < DETAIL_RETRIES,
    }),
}
