import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Page } from '@/lib/queries/page'

// Mirrors `SlotRead` (`api/app/schemas/slot.py`); an open slot is computed, never stored.
export type AvailableSlot = {
  tutor_id: string
  tutor_name: string
  availability_id: string
  date: string
  start_time: string
  end_time: string
}

export type SlotParams = {
  subject_id: string
  date: string
  child_id?: string
  tutor_id?: string
  // An edit leaves the Booking being edited out of its own neighbours.
  exclude_booking_id?: string
}

export const slotSearchParams = (params: SlotParams): string => {
  const search = new URLSearchParams({
    subject_id: params.subject_id,
    date: params.date,
  })

  if (params.child_id !== undefined) {
    search.append('child_id', params.child_id)
  }
  if (params.tutor_id !== undefined) {
    search.append('tutor_id', params.tutor_id)
  }
  if (params.exclude_booking_id !== undefined) {
    search.append('exclude_booking_id', params.exclude_booking_id)
  }

  return search.toString()
}

export const slotQueries = {
  available: (params: SlotParams) =>
    queryOptions({
      queryKey: ['slots', 'available', params],
      queryFn: async () => {
        const response = await api.get<Page<AvailableSlot>>(
          `/api/slots/available?${slotSearchParams(params)}`,
        )

        return response.data
      },
    }),
}
