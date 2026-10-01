import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { DEFAULT_PAGE_SIZE, type Page } from '@/lib/queries/page'

export type HouseholdGuardian = {
  id: string
  name: string
  phone_number: string
  is_active: boolean
}

export type HouseholdChild = {
  id: string
  name: string
  grade_level: number | null
  is_active: boolean
}

export type Household = {
  key: string
  guardians: HouseholdGuardian[]
  children: HouseholdChild[]
}

export type HouseholdListParams = {
  q?: string
  page?: number
  page_size?: number
}

export const householdQueries = {
  list: (params: HouseholdListParams = {}) =>
    queryOptions({
      queryKey: ['households', 'list', params],
      queryFn: async () => {
        const response = await api.get<Page<Household>>('/api/households', {
          params: { page_size: DEFAULT_PAGE_SIZE, ...params },
        })

        return response.data
      },
      placeholderData: keepPreviousData,
    }),
}
