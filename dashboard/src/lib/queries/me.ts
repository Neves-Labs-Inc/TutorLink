import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Role } from '@/lib/auth/auth'

export type Me = {
  id: string
  email: string
  role: Role
  name: string
}

export const meQueries = {
  detail: () =>
    queryOptions({
      queryKey: ['me'],
      queryFn: async () => {
        const response = await api.get<Me>('/api/me')

        return response.data
      },
    }),
}

export type MeUpdatePayload = {
  name: string
}

export const updateMe = async (data: MeUpdatePayload): Promise<Me> => {
  const response = await api.patch<Me>('/api/me', data)

  return response.data
}
