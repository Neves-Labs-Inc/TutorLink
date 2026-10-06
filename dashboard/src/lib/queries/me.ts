import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Role } from '@/lib/auth/auth'

export type Me = {
  id: string
  email: string
  role: Role
  display_name: string
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
