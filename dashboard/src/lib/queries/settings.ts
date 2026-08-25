import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Setting, SettingUpdate } from '@/lib/settings'

type Page<T> = {
  items: T[]
  total: number
  page: number
  page_size: number
}

export const settingQueries = {
  list: () =>
    queryOptions({
      queryKey: ['settings', 'list'],
      queryFn: async () => {
        const response = await api.get<Page<Setting>>('/api/settings')

        return response.data.items
      },
    }),
}

export const updateSettings = async (updates: SettingUpdate[]): Promise<Setting[]> => {
  const response = await api.patch<Page<Setting>>('/api/settings', { updates })

  return response.data.items
}
