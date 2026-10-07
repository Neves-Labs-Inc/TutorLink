import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { DEFAULT_PAGE_SIZE, type Page } from '@/lib/queries/page'

export type Subject = {
  id: string
  name: string
  name_es: string | null
  description: string | null
  is_active: boolean
  tutor_count: number
}

export type SubjectListParams = {
  is_active?: boolean
  page?: number
  page_size?: number
}

export type SubjectCreate = {
  name: string
  name_es?: string | null
  description?: string | null
}

export type SubjectUpdate = {
  name?: string
  name_es?: string | null
  description?: string | null
  is_active?: boolean
}

export const subjectQueries = {
  // Whole `Page<T>` rather than `.items` (unlike `settings.ts`): every list view here needs
  // `total` for its `Pager`, and `settings.ts` has no pager.
  list: (params: SubjectListParams = {}) =>
    queryOptions({
      queryKey: ['subjects', 'list', params],
      queryFn: async () => {
        const response = await api.get<Page<Subject>>('/api/subjects', {
          params: { page_size: DEFAULT_PAGE_SIZE, ...params },
        })

        return response.data
      },
      placeholderData: keepPreviousData,
    }),
}

export const createSubject = async (data: SubjectCreate): Promise<Subject> => {
  const response = await api.post<Subject>('/api/subjects', data)

  return response.data
}

export const updateSubject = async (subjectId: string, data: SubjectUpdate): Promise<Subject> => {
  const response = await api.patch<Subject>(`/api/subjects/${subjectId}`, data)

  return response.data
}

export const deactivateSubject = async (subjectId: string): Promise<Subject> => {
  const response = await api.delete<Subject>(`/api/subjects/${subjectId}`)

  return response.data
}
