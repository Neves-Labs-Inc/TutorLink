import { queryOptions } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type { Page } from '@/lib/queries/page'

type ExceptionStatus = 'pending' | 'approved' | 'rejected'

const EXCEPTION_PAGE_SIZE = 100

// Office-wide Time off as `GET /api/exceptions` reads it (`ExceptionRead`): the holder comes as
// a Staff ref whose `id` is the user's id.
export type OfficeTimeOff = {
  id: string
  staff: { id: string; name: string; role: 'tutor' | 'manager' | 'admin' }
  start_date: string
  end_date: string
  start_time: string | null
  end_time: string | null
  status: ExceptionStatus | 'cancelled' | 'expired'
}

export const officeTimeOffQueries = {
  // Approved Time off overlapping `from`..`to`, both inclusive.
  approved: (from: string, to: string) =>
    queryOptions({
      queryKey: ['exceptions', 'office', 'approved', { from, to }],
      queryFn: async () => {
        const response = await api.get<Page<OfficeTimeOff>>('/api/exceptions', {
          params: { status: 'approved', from, to, page_size: EXCEPTION_PAGE_SIZE },
        })

        return response.data
      },
    }),
}
