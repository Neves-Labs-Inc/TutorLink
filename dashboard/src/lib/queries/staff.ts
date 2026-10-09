import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
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
}
