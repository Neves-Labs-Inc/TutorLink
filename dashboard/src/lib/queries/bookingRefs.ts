import { queryOptions } from '@tanstack/react-query'

import { availabilityQueries } from '@/lib/queries/availability'

export const bookingRefQueries = {
  tutorAvailability: (tutorId: string) =>
    queryOptions({
      ...availabilityQueries.forTutor(tutorId),
      enabled: tutorId !== '',
    }),
}
