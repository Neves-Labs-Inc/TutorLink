import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import { useWeekQueries } from "@/hooks/use-week-queries";

const WEEK = "2026-10-19";
const PREVIOUS_WEEK = "2026-10-12";
const NEXT_WEEK = "2026-10-26";
const WEEK_AFTER_NEXT = "2026-11-02";

function setup(failingWeek?: string) {
  const fetched: string[] = [];
  const state = { isFailing: failingWeek !== undefined };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const queryForWeek = (weekStart: string) => ({
    queryKey: ["week", weekStart],
    queryFn: async () => {
      fetched.push(weekStart);
      if (weekStart === failingWeek && state.isFailing) throw new Error("boom");
      return { weekStart };
    },
  });
  function Wrapper({ children }: { children: ReactNode }): React.ReactNode {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return { fetched, state, queryForWeek, Wrapper };
}

// The observer only re-renders for fields the hook's caller reads, so read
// them all the way a component showing the week would.
function useWeek(
  weekStart: string,
  queryForWeek: ReturnType<typeof setup>["queryForWeek"],
) {
  const { data, isLoading, isError, refetch } = useWeekQueries(
    weekStart,
    queryForWeek,
  );
  return { data, isLoading, isError, refetch };
}

describe("useWeekQueries", () => {
  it("loads the current week first, then the weeks either side", async () => {
    const { fetched, queryForWeek, Wrapper } = setup();

    const { result } = await renderHook(() => useWeek(WEEK, queryForWeek), {
      wrapper: Wrapper,
    });

    await vi.waitFor(() => expect(fetched).toHaveLength(3));
    expect(fetched[0]).toBe(WEEK);
    expect(fetched.slice(1).sort()).toEqual([PREVIOUS_WEEK, NEXT_WEEK]);
    expect(result.current.data).toEqual({ weekStart: WEEK });
  });

  it("shows a cached week at once and loads the week beyond it", async () => {
    const { fetched, queryForWeek, Wrapper } = setup();
    const { result, rerender } = await renderHook(
      (props?: { weekStart: string }) =>
        useWeek(props?.weekStart ?? WEEK, queryForWeek),
      { wrapper: Wrapper },
    );
    await vi.waitFor(() => expect(fetched).toHaveLength(3));

    await rerender({ weekStart: NEXT_WEEK });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual({ weekStart: NEXT_WEEK });
    await vi.waitFor(() => expect(fetched).toContain(WEEK_AFTER_NEXT));
    expect(fetched.filter((week) => week === WEEK)).toHaveLength(1);
  });

  it("retries only the failed week when refetching", async () => {
    const { fetched, state, queryForWeek, Wrapper } = setup(WEEK);

    const { result } = await renderHook(() => useWeek(WEEK, queryForWeek), {
      wrapper: Wrapper,
    });
    await vi.waitFor(() => expect(result.current.isError).toBe(true));
    const callsBeforeRetry = fetched.length;
    expect(new Set(fetched)).toEqual(new Set([WEEK]));

    state.isFailing = false;
    await result.current.refetch();

    await vi.waitFor(() => expect(result.current.data).toBeDefined());
    expect(fetched.slice(callsBeforeRetry, callsBeforeRetry + 1)).toEqual([WEEK]);
  });
});
