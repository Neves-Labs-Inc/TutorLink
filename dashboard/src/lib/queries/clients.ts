import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { bookingSearchParams, type Booking, type BookingListParams } from '@/lib/queries/bookings'
import { DEFAULT_PAGE_SIZE, type Page } from '@/lib/queries/page'

export type Client = {
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

export type ClientChild = {
  id: string
  name: string
  date_of_birth: string | null
  grade_level: number
  school_name: string
  notes: string | null
}

export type ClientDetail = {
  id: string
  name: string
  phone_number: string
  is_active: boolean
  homes: Home[]
  children: ClientChild[]
}

export type ClientListParams = {
  q?: string
  is_active?: boolean
  page?: number
  page_size?: number
}

export type ClientUpdate = {
  name?: string
  phone_number?: string
  is_active?: boolean
}

export type ClientCreate = {
  name: string
  phone_number: string
  home?: {
    label?: string | null
    address: string
    access_code: string
  }
}

export const clientQueries = {
  // Whole `Page<T>` rather than `.items` (unlike `settings.ts`): every list view here needs
  // `total` for its `Pager`, and `settings.ts` has no pager.
  list: (params: ClientListParams = {}) =>
    queryOptions({
      queryKey: ['clients', 'list', params],
      queryFn: async () => {
        const response = await api.get<Page<Client>>('/api/clients', {
          params: { page_size: DEFAULT_PAGE_SIZE, ...params },
        })

        return response.data
      },
      placeholderData: keepPreviousData,
    }),

  detail: (clientId: string) =>
    queryOptions({
      queryKey: ['clients', 'detail', clientId],
      queryFn: async () => {
        const response = await api.get<ClientDetail>(`/api/clients/${clientId}`)

        return response.data
      },
    }),

  bookings: (clientId: string, params: BookingListParams = {}) =>
    queryOptions({
      queryKey: ['clients', 'bookings', clientId, params],
      queryFn: async () => {
        const response = await api.get<Page<Booking>>(
          `/api/clients/${clientId}/bookings?${bookingSearchParams(params)}`,
        )

        return response.data
      },
      placeholderData: keepPreviousData,
    }),
}

export const createClient = async (data: ClientCreate): Promise<ClientDetail> => {
  const response = await api.post<ClientDetail>('/api/clients', data)

  return response.data
}

export const updateClient = async (clientId: string, data: ClientUpdate): Promise<ClientDetail> => {
  const response = await api.patch<ClientDetail>(`/api/clients/${clientId}`, data)

  return response.data
}
