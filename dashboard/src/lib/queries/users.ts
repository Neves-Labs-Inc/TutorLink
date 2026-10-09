import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Role } from '@/lib/auth/auth'
import { DEFAULT_PAGE_SIZE, type Page } from '@/lib/queries/page'
import type { UserCreatePayload, UserUpdatePayload } from '@/lib/users/users'

export type User = {
  id: string
  email: string
  name: string
  role: Role
  tutor_id: string | null
  is_active: boolean
}

export type UserListParams = {
  is_active?: boolean
  page?: number
  page_size?: number
}

export const userQueries = {
  list: (params: UserListParams = {}) =>
    queryOptions({
      queryKey: ['users', 'list', params],
      queryFn: async () => {
        const response = await api.get<Page<User>>('/api/users', {
          params: { page_size: DEFAULT_PAGE_SIZE, ...params },
        })

        return response.data
      },
      placeholderData: keepPreviousData,
    }),
}

export const createUser = async (data: UserCreatePayload): Promise<User> => {
  const response = await api.post<User>('/api/users', data)

  return response.data
}

export const updateUser = async (userId: string, data: UserUpdatePayload): Promise<User> => {
  const response = await api.patch<User>(`/api/users/${userId}`, data)

  return response.data
}

export const deactivateUser = async (userId: string): Promise<User> => {
  const response = await api.delete<User>(`/api/users/${userId}`)

  return response.data
}
