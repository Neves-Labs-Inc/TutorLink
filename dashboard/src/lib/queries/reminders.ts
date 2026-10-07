import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { ReminderWeek } from '@/lib/reminders/reminders'

export type ReminderWeekParams = {
  // Null is the default week: the API picks it, and the Next button needs its date.
  weekStart: string | null
  statuses?: string
}

export const reminderQueries = {
  week: ({ weekStart, statuses }: ReminderWeekParams) =>
    queryOptions({
      queryKey: ['reminders', 'week', weekStart ?? 'default', statuses ?? 'all'],
      queryFn: async () => {
        const response = await api.get<ReminderWeek>('/api/reminders/week', {
          params: { week_start: weekStart ?? undefined, status: statuses },
        })

        return response.data
      },
    }),
}
