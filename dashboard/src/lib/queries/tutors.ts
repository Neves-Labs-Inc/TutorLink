import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { DEFAULT_PAGE_SIZE, type Page } from '@/lib/queries/page'

export type TutorSubject = { subject_id: string; name: string; max_grade_level: number }

export type Tutor = {
  id: string
  // The account behind the profile: what `POST /api/bookings.user_id` takes.
  user_id: string
  name: string
  email: string
  phone_number: string
  bio: string | null
  is_active: boolean
  subjects: TutorSubject[]
}

export type TutorListParams = {
  q?: string
  subject_id?: string
  grade_level?: number
  is_active?: boolean
  page?: number
  page_size?: number
}

export type TutorCreate = {
  name: string
  email: string
  phone_number: string
  bio?: string | null
}

export type TutorUpdate = {
  name?: string
  email?: string
  phone_number?: string
  bio?: string | null
  is_active?: boolean
}

export const tutorQueries = {
  // Whole `Page<T>` rather than `.items` (unlike `settings.ts`): every list view here needs
  // `total` for its `Pager`, and `settings.ts` has no pager.
  list: (params: TutorListParams = {}) =>
    queryOptions({
      queryKey: ['tutors', 'list', params],
      queryFn: async () => {
        const response = await api.get<Page<Tutor>>('/api/tutors', {
          params: { page_size: DEFAULT_PAGE_SIZE, ...params },
        })

        return response.data
      },
      placeholderData: keepPreviousData,
    }),

  detail: (tutorId: string) =>
    queryOptions({
      queryKey: ['tutors', 'detail', tutorId],
      queryFn: async () => {
        const response = await api.get<Tutor>(`/api/tutors/${tutorId}`)

        return response.data
      },
    }),
}

export const createTutor = async (data: TutorCreate): Promise<Tutor> => {
  const response = await api.post<Tutor>('/api/tutors', data)

  return response.data
}

export const updateTutor = async (tutorId: string, data: TutorUpdate): Promise<Tutor> => {
  const response = await api.patch<Tutor>(`/api/tutors/${tutorId}`, data)

  return response.data
}

export const deactivateTutor = async (tutorId: string): Promise<Tutor> => {
  const response = await api.delete<Tutor>(`/api/tutors/${tutorId}`)

  return response.data
}
