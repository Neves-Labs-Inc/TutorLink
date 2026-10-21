import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'

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

export const tutorQueries = {
  detail: (tutorId: string) =>
    queryOptions({
      queryKey: ['tutors', 'detail', tutorId],
      queryFn: async () => {
        const response = await api.get<Tutor>(`/api/tutors/${encodeURIComponent(tutorId)}`)

        return response.data
      },
    }),
}
