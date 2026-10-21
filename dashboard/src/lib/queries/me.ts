import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Role } from '@/lib/auth/auth'

export type Me = {
  id: string
  email: string
  role: Role
  name: string
  // True once the person has dismissed their landing-page welcome card; never goes back.
  welcome_seen: boolean
  // The caller's own teaching profile id, or null for someone with none.
  tutor_id: string | null
  // The office's E.164 number, or null while an Admin hasn't set one.
  office_phone: string | null
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

export const markWelcomeSeen = async (): Promise<void> => {
  await api.post('/api/me/welcome-seen')
}
