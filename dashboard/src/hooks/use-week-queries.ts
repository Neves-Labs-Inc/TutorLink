import {
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useEffect } from "react";
import { addWeeks } from "@/lib/week";

// Loaded weeks stay for the whole session: never garbage collected, so paging
// back to a visited week is instant.
const WEEK_GC_TIME = Infinity;
// Within this window a loaded week counts as fresh, so stepping between weeks
// doesn't refetch the one just left.
const WEEK_STALE_TIME_MS = 30_000;

type WeekQueryOptions<T> = UseQueryOptions<T, Error, T, QueryKey>;

// Loads `weekStart` first, then prefetches the weeks either side once it has
// loaded. Returns the current week's query result.
export function useWeekQueries<T>(
  weekStart: string,
  queryForWeek: (weekStart: string) => WeekQueryOptions<T>,
): UseQueryResult<T, Error> {
  const queryClient = useQueryClient();
  const getOptions = (week: string): WeekQueryOptions<T> => ({
    staleTime: WEEK_STALE_TIME_MS,
    ...queryForWeek(week),
    gcTime: WEEK_GC_TIME,
  });

  const current = useQuery(getOptions(weekStart));
  const isLoaded = current.isSuccess;

  useEffect(() => {
    if (!isLoaded) return;
    for (const offset of [-1, 1]) {
      // A failed neighbour is retried when the user reaches it.
      void queryClient.prefetchQuery(getOptions(addWeeks(weekStart, offset)));
    }
    // getOptions only closes over queryForWeek, which callers rebuild each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, weekStart, queryClient]);

  return current;
}
