// Needs attention: To do's whole Bookings list, across every date and in
// To do's order. Bookings to sort out (the API limits a Manager to their
// own), Children needing a Tutor and Children awaiting an Evaluation,
// merged by buildBookingTodo and paged here in the browser.
import { useQuery } from "@tanstack/react-query";
import { buildBookingTodo } from "@/lib/bookings/booking-todo";
import type { BookingTodoItem } from "@/lib/bookings/booking-todo";
import { bookingQueries } from "@/lib/queries/bookings";
import { childQueries } from "@/lib/queries/children";

export const NEEDS_ATTENTION_PAGE_SIZE = 20;
// The API's largest page.
const CHILD_PAGE_SIZE = 100;

export type NeedsAttentionState =
  | { status: "loading" }
  | { status: "error"; retry: () => void; isRetrying: boolean }
  | {
      status: "ready";
      items: BookingTodoItem[];
      total: number;
      // The page shown: the one asked for, or the last when it is past the end.
      page: number;
    };

type NeedsAttentionOptions = { page: number; isEnabled: boolean };

export function useNeedsAttention({
  page,
  isEnabled,
}: NeedsAttentionOptions): NeedsAttentionState {
  // Every page of Bookings to sort out, at the API's largest page size.
  const bookings = useQuery({
    ...bookingQueries.week({ to_sort_out: true }),
    enabled: isEnabled,
  });
  const needingTutor = useQuery({
    ...childQueries.list({ needs_tutor: true, page_size: CHILD_PAGE_SIZE }),
    enabled: isEnabled,
  });
  const awaitingEvaluation = useQuery({
    ...childQueries.list({
      awaiting_evaluation: true,
      page_size: CHILD_PAGE_SIZE,
    }),
    enabled: isEnabled,
  });
  // A query with no data that has failed, kept as failed while Try again
  // runs (TanStack puts it back to pending meanwhile).
  const failed = [bookings, needingTutor, awaitingEvaluation].filter(
    (query) => !query.data && query.errorUpdatedAt > 0,
  );

  let state: NeedsAttentionState;
  if (bookings.data && needingTutor.data && awaitingEvaluation.data) {
    const all = buildBookingTodo(
      bookings.data.items,
      needingTutor.data.items,
      awaitingEvaluation.data.items,
    );
    const lastPage = Math.max(
      1,
      Math.ceil(all.length / NEEDS_ATTENTION_PAGE_SIZE),
    );
    const shownPage = Math.min(page, lastPage);
    const start = (shownPage - 1) * NEEDS_ATTENTION_PAGE_SIZE;
    state = {
      status: "ready",
      items: all.slice(start, start + NEEDS_ATTENTION_PAGE_SIZE),
      total: all.length,
      page: shownPage,
    };
  } else if (failed.length > 0) {
    state = {
      status: "error",
      retry: () => failed.forEach((query) => void query.refetch()),
      isRetrying: failed.some((query) => query.isFetching),
    };
  } else {
    state = { status: "loading" };
  }
  return state;
}
