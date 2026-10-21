// A person's whole Availability week: every row of the read, and the
// whole-week write. The old `availabilityQueries.forTutor` reads only the
// first page, which can miss active rows (see `fetchAvailabilityWeek`).
import { queryOptions } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AvailabilityMode, AvailabilitySlot } from "@/lib/queries/availability";
import type { Page } from "@/lib/queries/page";

// The API's page cap.
const WEEK_PAGE_SIZE = 100;

// Mirrors `AvailabilityWeekSlot` in `api/app/schemas/availability.py`:
// naive whole-minute "HH:MM:SS" times, 0 = Monday.
export type AvailabilityWeekSlot = {
  day_of_week: number;
  start_time: string;
  end_time: string;
  mode: AvailabilityMode;
};

export type AvailabilityWeek = { slots: AvailabilityWeekSlot[] };

// The read returns inactive rows too, and they pile up (a PUT deactivates
// rather than deletes), so one page can end before the week's last active
// slot. A Save built from a short read would deactivate the rest.
export async function fetchAvailabilityWeek(
  tutorId: string,
): Promise<Page<AvailabilitySlot>> {
  const items: AvailabilitySlot[] = [];
  let total = 0;
  let page = 1;
  let isDone = false;
  while (!isDone) {
    const response = await api.get<Page<AvailabilitySlot>>(
      `/api/tutors/${tutorId}/availability`,
      { params: { page, page_size: WEEK_PAGE_SIZE } },
    );
    items.push(...response.data.items);
    total = response.data.total;
    // An empty page ends it too, in case rows vanish between requests.
    isDone = items.length >= total || response.data.items.length === 0;
    page += 1;
  }
  return { items, total, page: 1, page_size: items.length };
}

export const availabilityWeekQueries = {
  // Its own key: the old first-page read shares the ['availability', id] prefix.
  forTutor: (tutorId: string) =>
    queryOptions({
      queryKey: ["availability", tutorId, "week"],
      queryFn: () => fetchAvailabilityWeek(tutorId),
    }),
};

// Replaces the person's whole active week; the answer is the new week.
export async function replaceAvailabilityWeek(
  tutorId: string,
  week: AvailabilityWeek,
): Promise<Page<AvailabilitySlot>> {
  const response = await api.put<Page<AvailabilitySlot>>(
    `/api/tutors/${tutorId}/availability`,
    week,
  );
  return response.data;
}
