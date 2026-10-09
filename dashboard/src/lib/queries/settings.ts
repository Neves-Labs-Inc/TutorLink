import { queryOptions, skipToken } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { EmailDraftPayload } from '@/lib/settings/emailTemplates'
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

  // The draft rendered by the API with sample values; skipped while `payload` is null.
  // A 400 carries the validation `detail`, which retrying cannot fix.
  emailPreview: (payload: EmailDraftPayload | null) =>
    queryOptions({
      queryKey: ['settings', 'email-preview', payload],
      queryFn:
        payload === null
          ? skipToken
          : async ({ signal }) => {
              const response = await api.post<EmailPreview>('/api/settings/email-templates/preview', payload, {
                signal,
              })

              return response.data
            },
      retry: false,
    }),
}

export const updateSettings = async (updates: SettingUpdate[]): Promise<SettingsPage> => {
  const response = await api.patch<SettingsPage>('/api/settings', { updates })

  return response.data
}

export type EmailPreview = {
  subject: string
  html: string
}

// Sends the draft as typed, saved or not, with the draft colour, to the signed-in user; 204 on success.
export const sendTestEmail = async (payload: EmailDraftPayload): Promise<void> => {
  await api.post('/api/settings/email-templates/test', payload)
}
