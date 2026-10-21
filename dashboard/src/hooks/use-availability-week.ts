import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import type { AvailabilitySlot } from "@/components/kit/types/domain";
import { toWeekPayload } from "@/lib/availability/availability-week";
import type { AvailabilitySlot as WireSlot } from "@/lib/queries/availability";
import {
  availabilityWeekQueries,
  replaceAvailabilityWeek,
} from "@/lib/queries/availability-week";
import type { Page } from "@/lib/queries/page";

type AvailabilityWeekState = {
  week: UseQueryResult<Page<WireSlot>>;
  save: UseMutationResult<Page<WireSlot>, Error, AvailabilitySlot[]>;
};

// One person's weekly Availability: the read and the whole-week save.
export function useAvailabilityWeek(tutorId: string): AvailabilityWeekState {
  const queryClient = useQueryClient();
  const { queryKey } = availabilityWeekQueries.forTutor(tutorId);
  const week = useQuery(availabilityWeekQueries.forTutor(tutorId));

  const save = useMutation({
    mutationFn: (slots: AvailabilitySlot[]) =>
      replaceAvailabilityWeek(tutorId, toWeekPayload(slots)),
    onSuccess: async (saved) => {
      // Cancel first so a GET already in flight can't land after and restore the old week.
      await queryClient.cancelQueries({ queryKey });
      // The PUT answers with the new week, so no refetch is needed.
      queryClient.setQueryData(queryKey, saved);
      // Older screens (the booking form) read the first page under the bare key.
      void queryClient.invalidateQueries({
        queryKey: ["availability", tutorId],
        exact: true,
      });
    },
  });

  return { week, save };
}
