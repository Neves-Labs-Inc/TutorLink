import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { bookingSearchParams, type Booking, type BookingListParams } from '@/lib/queries/bookings'
import { DEFAULT_PAGE_SIZE, type Page } from '@/lib/queries/page'

export type Guardian = {
  id: string
  name: string
  phone_number: string
  is_active: boolean
  home_count: number
  child_count: number
}

export type Home = {
  id: string
  label: string | null
  address: string
  access_code: string
  is_active: boolean
}

export type GuardianChild = {
  id: string
  name: string
  date_of_birth: string | null
  grade_level: number | null
  school_name: string
  notes: string | null
  is_active: boolean
}

export type GuardianDetail = {
  id: string
  name: string
  phone_number: string
  is_active: boolean
  homes: Home[]
  children: GuardianChild[]
}

export type GuardianListParams = {
  q?: string
  phone_number?: string
  is_active?: boolean
  page?: number
  page_size?: number
}

export type GuardianUpdate = {
  name?: string
  phone_number?: string
  is_active?: boolean
}

export type GuardianCreate = {
  name: string
  phone_number: string
  home?: {
    label?: string | null
    address: string
    access_code: string
  }
}

export const guardianQueries = {
  // Whole `Page<T>` rather than `.items` (unlike `settings.ts`): every list view here needs
  // `total` for its `Pager`, and `settings.ts` has no pager.
  list: (params: GuardianListParams = {}) =>
    queryOptions({
      queryKey: ['guardians', 'list', params],
      queryFn: async () => {
        const response = await api.get<Page<Guardian>>('/api/clients', {
          params: { page_size: DEFAULT_PAGE_SIZE, ...params },
        })

        return response.data
      },
      placeholderData: keepPreviousData,
    }),

  detail: (guardianId: string) =>
    queryOptions({
      queryKey: ['guardians', 'detail', guardianId],
      queryFn: async () => {
        const response = await api.get<GuardianDetail>(`/api/clients/${guardianId}`)

        return response.data
      },
    }),

  bookings: (guardianId: string, params: BookingListParams = {}) =>
    queryOptions({
      queryKey: ['guardians', 'bookings', guardianId, params],
      queryFn: async () => {
        const response = await api.get<Page<Booking>>(
          `/api/clients/${guardianId}/bookings?${bookingSearchParams(params)}`,
        )

        return response.data
      },
      placeholderData: keepPreviousData,
    }),
}

export const createGuardian = async (data: GuardianCreate): Promise<GuardianDetail> => {
  const response = await api.post<GuardianDetail>('/api/clients', data)

  return response.data
}

export const updateGuardian = async (
  guardianId: string,
  data: GuardianUpdate,
): Promise<GuardianDetail> => {
  const response = await api.patch<GuardianDetail>(`/api/clients/${guardianId}`, data)

  return response.data
}

export const findGuardianByPhone = async (
  phoneNumber: string,
  isActive: boolean,
): Promise<Guardian | null> => {
  const response = await api.get<Page<Guardian>>('/api/clients', {
    params: { phone_number: phoneNumber, is_active: isActive, page_size: 1 },
  })

  return response.data.items[0] ?? null
}
