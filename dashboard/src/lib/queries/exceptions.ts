import { queryOptions } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type { Page } from '@/lib/queries/page'

export type ExceptionStatus = 'pending' | 'approved' | 'rejected'

export type ExceptionReason = 'vacation' | 'personal' | 'sick' | 'other'

export type TutorException = {
  id: string
  tutor_id: string
  // Both ends inclusive, and `start_time`/`end_time` apply to every day in that span rather
  // than running continuously from the first date to the last.
  start_date: string
  end_date: string
  start_time: string | null
  end_time: string | null
  reason: string
  notes: string | null
  status: ExceptionStatus
  created_at: string
}

// No `status` field, mirroring `ExceptionCreate` in `api/app/schemas/exceptions.py`: a status on
// the request body would let a tutor self-approve by adding one key to their JSON, so the server
// derives it from the caller's role. An admin's entry lands `approved` because an admin sent it.
export type ExceptionCreate = {
  start_date: string
  end_date: string
  start_time: string | null
  end_time: string | null
  reason: ExceptionReason
  notes: string | null
}

export type ExceptionDecision = Exclude<ExceptionStatus, 'pending'>

const EXCEPTION_PAGE_SIZE = 100

export const exceptionQueries = {
  forTutor: (tutorId: string) =>
    queryOptions({
      queryKey: ['exceptions', tutorId],
      queryFn: async () => {
        const response = await api.get<Page<TutorException>>(`/api/tutors/${tutorId}/exceptions`, {
          params: { page_size: EXCEPTION_PAGE_SIZE },
        })

        return response.data
      },
    }),
}

export const createException = async (
  tutorId: string,
  data: ExceptionCreate,
): Promise<TutorException> => {
  const response = await api.post<TutorException>(`/api/tutors/${tutorId}/exceptions`, data)

  return response.data
}

export const decideException = async (
  exceptionId: string,
  status: ExceptionDecision,
): Promise<TutorException> => {
  const response = await api.patch<TutorException>(`/api/exceptions/${exceptionId}`, { status })

  return response.data
}

export const deleteException = async (exceptionId: string): Promise<void> => {
  await api.delete(`/api/exceptions/${exceptionId}`)
}
