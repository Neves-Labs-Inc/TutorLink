import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { TemplateSectionId } from '@/lib/settings/emailTemplates'
import type { Setting, SettingUpdate } from '@/lib/settings/settings'

export type SettingsPage = {
  items: Setting[]
  total: number
  page: number
  page_size: number
  business_timezone_locked: boolean
  reminders_paused: boolean
}

const settingsPageQuery = () =>
  queryOptions({
    queryKey: ['settings', 'list'],
    queryFn: async () => {
      const response = await api.get<SettingsPage>('/api/settings')

      return response.data
    },
  })

export const settingQueries = {
  // The rows only, for callers that ignore the flags.
  list: () => queryOptions({ ...settingsPageQuery(), select: (page) => page.items }),

  // The rows plus `business_timezone_locked` and `reminders_paused`; shares the cache with `list`.
  page: settingsPageQuery,
}

export const updateSettings = async (updates: SettingUpdate[]): Promise<SettingsPage> => {
  const response = await api.patch<SettingsPage>('/api/settings', { updates })

  return response.data
}

export type TestEmailPayload = {
  template: TemplateSectionId
  subject: string
  body: string
}

// Sends the draft as typed, saved or not, to the signed-in user; 204 on success.
export const sendTestEmail = async (payload: TestEmailPayload): Promise<void> => {
  await api.post('/api/settings/email-templates/test', payload)
}
