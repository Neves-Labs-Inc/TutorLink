import { api } from '@/lib/api'
import type { Home } from '@/lib/queries/guardians'

export type GuardianHomeCreate = {
  label?: string | null
  address: string
  access_code: string
  child_ids?: string[]
}

export type HomeUpdate = {
  label?: string | null
  address?: string
  access_code?: string
  is_active?: boolean
}

export const createHome = async (guardianId: string, data: GuardianHomeCreate): Promise<Home> => {
  const response = await api.post<Home>(`/api/clients/${guardianId}/homes`, data)

  return response.data
}

export const updateHome = async (homeId: string, data: HomeUpdate): Promise<Home> => {
  const response = await api.patch<Home>(`/api/homes/${homeId}`, data)

  return response.data
}
