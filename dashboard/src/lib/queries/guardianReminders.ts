import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type {
  ConsentAction,
  ConsentSource,
  GuardianConsent,
  LastReminder,
} from '@/lib/guardians/reminders'

export type ConsentHistoryEntry = {
  id: string
  action: ConsentAction
  source: ConsentSource
  created_at: string
  who: string
}

export type GuardianReminders = {
  consent: GuardianConsent
  last_reminder: LastReminder | null
  history: ConsentHistoryEntry[]
}

export const guardianReminderQueries = {
  detail: (guardianId: string) =>
    queryOptions({
      queryKey: ['guardians', 'reminders', guardianId],
      queryFn: async () => {
        const response = await api.get<GuardianReminders>(`/api/clients/${guardianId}/reminders`)

        return response.data
      },
    }),
}

export const recordConsent = async (
  guardianId: string,
  action: ConsentAction,
): Promise<GuardianReminders> => {
  const response = await api.post<GuardianReminders>(`/api/clients/${guardianId}/reminders/consent`, {
    action,
  })

  return response.data
}
