import { queryOptions } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type { Page } from '@/lib/queries/page'

// Mirrors `AvailabilityMode` in the API: Home visits, Home or office, Office only.
export type AvailabilityMode = 'traveler' | 'anywhere' | 'only_office'

export type AvailabilitySlot = {
  id: string
  tutor_id: string
  // 0 = Monday … 6 = Sunday, not JavaScript's 0 = Sunday. Never build one from `Date.getDay()`;
  // `dayOfWeekFromIso` in `lib/availability.ts` is the only sanctioned conversion.
  day_of_week: number
  start_time: string
  end_time: string
  is_active: boolean
  mode: AvailabilityMode
}

export type SlotCreate = {
  day_of_week: number
  start_time: string
  end_time: string
  mode: AvailabilityMode
}

// No `day_of_week`, mirroring `AvailabilityUpdate` in `api/app/schemas/availability.py`:
// moving a slot to another day is a delete plus a create, never an edit.
export type SlotUpdate = {
  start_time?: string
  end_time?: string
  is_active?: boolean
  mode?: AvailabilityMode
}

const SLOT_PAGE_SIZE = 100

export const availabilityQueries = {
  forTutor: (tutorId: string) =>
    queryOptions({
      queryKey: ['availability', tutorId],
      queryFn: async () => {
        const response = await api.get<Page<AvailabilitySlot>>(
          `/api/tutors/${tutorId}/availability`,
          { params: { page_size: SLOT_PAGE_SIZE } },
        )

        return response.data
      },
    }),
}

export const createSlot = async (tutorId: string, data: SlotCreate): Promise<AvailabilitySlot> => {
  const response = await api.post<AvailabilitySlot>(`/api/tutors/${tutorId}/availability`, data)

  return response.data
}

export const updateSlot = async (slotId: string, data: SlotUpdate): Promise<AvailabilitySlot> => {
  const response = await api.patch<AvailabilitySlot>(`/api/availability/${slotId}`, data)

  return response.data
}

export const deleteSlot = async (slotId: string): Promise<AvailabilitySlot> => {
  const response = await api.delete<AvailabilitySlot>(`/api/availability/${slotId}`)

  return response.data
}
