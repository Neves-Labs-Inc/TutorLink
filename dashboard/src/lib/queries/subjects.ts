import { keepPreviousData, queryOptions, type QueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { DEFAULT_PAGE_SIZE, type Page } from '@/lib/queries/page'
import type { ArchiveRead } from '@/types/families'

export type Subject = {
  id: string
  name: string
  name_es: string | null
  description: string | null
  archived: boolean
  tutor_count: number
}

// The API's page cap; the catalogue is far smaller.
const ACTIVE_PAGE_SIZE = 100

export type SubjectListParams = {
  archived?: boolean
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

  // Every Subject that can still be taught (not archived), in one page.
  active: () =>
    queryOptions({
      queryKey: ['subjects', 'active'],
      queryFn: async () => {
        const response = await api.get<Page<Subject>>('/api/subjects', {
          params: { archived: false, page_size: ACTIVE_PAGE_SIZE },
        })

        return response.data.items
      },
    }),
}

export const createSubject = async (data: SubjectCreate): Promise<Subject> => {
  const response = await api.post<Subject>('/api/subjects', data)

  return response.data
}

export const updateSubject = async (subjectId: string, data: SubjectUpdate): Promise<Subject> => {
  const response = await api.patch<Subject>(`/api/subjects/${encodeURIComponent(subjectId)}`, data)

  return response.data
}

export const archiveSubject = async (subjectId: string): Promise<ArchiveRead> => {
  const response = await api.post<ArchiveRead>('/api/archive', { type: 'subject', id: subjectId })

  return response.data
}

export const restoreSubject = async (subjectId: string): Promise<ArchiveRead> => {
  const response = await api.post<ArchiveRead>('/api/restore', { type: 'subject', id: subjectId })

  return response.data
}

// After any Subject write: every `['subjects', ...]` query (list and active) refetches.
export const refreshSubjects = (client: QueryClient): Promise<void> =>
  client.invalidateQueries({ queryKey: ['subjects'] })
