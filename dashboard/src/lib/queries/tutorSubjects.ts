import { api } from '@/lib/api'
import type { TutorSubject } from '@/lib/queries/tutors'

export type TutorSubjectCreate = {
  subject_id: string
  max_grade_level: number
}

export const assignSubject = async (
  tutorId: string,
  body: TutorSubjectCreate,
): Promise<TutorSubject> => {
  const response = await api.post<TutorSubject>(`/api/tutors/${tutorId}/subjects`, body)

  return response.data
}

export const removeSubject = async (tutorId: string, subjectId: string): Promise<void> => {
  await api.delete(`/api/tutors/${tutorId}/subjects/${subjectId}`)
}
