import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Booking } from '@/lib/queries/bookings'

export type StatsOverview = {
  date: string
  week_end: string
  today_session_count: number
  upcoming_week_session_count: number
  active_tutor_count: number
  active_client_count: number
  recent_bookings: Booking[]
}

export const statsQueries = {
  overview: (date: string) =>
    queryOptions({
      queryKey: ['stats', 'overview', date],
      queryFn: async () => {
        const response = await api.get<StatsOverview>('/api/stats/overview', { params: { date } })

        return response.data
      },
    }),
}
