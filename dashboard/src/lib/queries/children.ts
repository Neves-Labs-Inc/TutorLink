import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { NamedRef } from '@/lib/queries/bookings'
import { DEFAULT_PAGE_SIZE, type Page } from '@/lib/queries/page'

export type ChildHomeRef = {
  id: string
  label: string | null
  address: string
  is_active: boolean
}

export type ChildHome = ChildHomeRef & {
  access_code: string
}

export type NextSession = {
  id: string
  scheduled_date: string
  start_time: string
  end_time: string
  tutor: NamedRef
  // Null on an Evaluation.
  subject: NamedRef | null
}

export type StaffRef = {
  id: string
  name: string
}

export type Evaluated = {
  at: string
  by: StaffRef
}

export type ChildLevel = {
  subject_id: string
  name: string
  is_active: boolean
  level: number
  set_by: StaffRef
  updated_at: string
}

export type ChildSummary = {
  id: string
  name: string
  grade_level: number | null
  school_name: string
  is_active: boolean
  guardians: NamedRef[]
  homes: ChildHomeRef[]
  next_session: NextSession | null
  evaluated: Evaluated | null
  created_at: string
}

export type ChildGuardian = {
  id: string
  name: string
  phone_number: string
  is_active: boolean
}

export type ChildDetail = {
  id: string
  name: string
  date_of_birth: string | null
  grade_level: number | null
  school_name: string
  notes: string | null
  is_active: boolean
  upcoming_session_count: number
  guardians: ChildGuardian[]
  homes: ChildHome[]
  levels: ChildLevel[]
  evaluated: Evaluated | null
}

export type ChildRecord = {
  id: string
  name: string
  date_of_birth: string | null
  grade_level: number | null
  school_name: string
  notes: string | null
  is_active: boolean
  guardian_ids: string[]
  home_ids: string[]
}

export type ChildListParams = {
  q?: string
  is_active?: boolean
  awaiting_evaluation?: boolean
  page?: number
  page_size?: number
}

export type ChildInput = {
  name: string
  date_of_birth: string
  grade_level?: number
  school_name: string
  notes?: string | null
}

export type ChildCreate = ChildInput & {
  guardian_ids: string[]
  home_ids: string[]
}

export type ChildUpdate = Partial<ChildInput> & {
  is_active?: boolean
  expected_cancellations?: number
  guardian_ids?: string[]
  home_ids?: string[]
}

export type GuardianLinkCreate =
  | { guardian_id: string; home_ids?: string[] }
  | { guardian: { name: string; phone_number: string }; home_ids?: string[] }

export const childQueries = {
  list: (params: ChildListParams = {}) =>
    queryOptions({
      queryKey: ['children', 'list', params],
      queryFn: async () => {
        const response = await api.get<Page<ChildSummary>>('/api/children', {
          params: { page_size: DEFAULT_PAGE_SIZE, ...params },
        })

        return response.data
      },
      placeholderData: keepPreviousData,
    }),

  detail: (childId: string) =>
    queryOptions({
      queryKey: ['children', 'detail', childId],
      queryFn: async () => {
        const response = await api.get<ChildDetail>(`/api/children/${childId}`)

        return response.data
      },
    }),
}

export const createChild = async (data: ChildCreate): Promise<ChildRecord> => {
  const response = await api.post<ChildRecord>('/api/children', data)

  return response.data
}

export const updateChild = async (childId: string, data: ChildUpdate): Promise<ChildRecord> => {
  const response = await api.patch<ChildRecord>(`/api/children/${childId}`, data)

  return response.data
}

export const linkGuardian = async (
  childId: string,
  data: GuardianLinkCreate,
): Promise<ChildRecord> => {
  const response = await api.post<ChildRecord>(`/api/children/${childId}/guardians`, data)

  return response.data
}

export const setChildLevel = async (
  childId: string,
  subjectId: string,
  level: number,
): Promise<ChildLevel> => {
  const response = await api.put<ChildLevel>(`/api/children/${childId}/levels/${subjectId}`, {
    level,
  })

  return response.data
}

export const removeChildLevel = async (childId: string, subjectId: string): Promise<void> => {
  await api.delete(`/api/children/${childId}/levels/${subjectId}`)
}

export const markChildEvaluated = async (childId: string): Promise<Evaluated> => {
  const response = await api.post<Evaluated>(`/api/children/${childId}/evaluated`)

  return response.data
}

export const clearChildEvaluated = async (childId: string): Promise<void> => {
  await api.delete(`/api/children/${childId}/evaluated`)
}
