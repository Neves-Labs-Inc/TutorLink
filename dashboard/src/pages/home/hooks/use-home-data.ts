// Every read Home makes. Each To do group and Today load and fail on
// their own; all of them refetch on window focus and every 60s, and the
// freshness cue reports how old the shown data is (TutorLink#189).
import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import type { TodoPhase } from "@/components/kit/components/todo-card";
import { getTodayKey } from "@/components/kit/format";
import { useNow } from "@/components/kit/hooks/use-now";
import { ADMIN_ROLES } from "@/lib/auth/auth";
import type { Role } from "@/lib/auth/auth";
import { buildBookingTodo } from "@/lib/bookings/booking-todo";
import type { BookingTodoItem } from "@/lib/bookings/booking-todo";
import { getFirstName } from "@/lib/chats/labels";
import { bookingQueries } from "@/lib/queries/bookings";
import type { BookingSummary } from "@/lib/queries/bookings";
import { childQueries } from "@/lib/queries/children";
import { conversationQueries } from "@/lib/queries/conversations";
import type { Conversation } from "@/lib/queries/conversations";
import { meQueries } from "@/lib/queries/me";
import { timeOffQueries } from "@/lib/queries/time-off";
import type { ExceptionRead } from "@/lib/queries/time-off";
import { getTodayOrder } from "@/pages/home/lib/home-labels";
import { useAuthStore } from "@/stores/authStore";

const HOME_REFRESH_MS = 60_000;
const HOME_REFRESH = {
  refetchInterval: HOME_REFRESH_MS,
  refetchOnWindowFocus: true,
} as const;
// The API's cap. The Children lists come in To do's order, so one page
// holds the first rows.
const TODO_PAGE_SIZE = 100;

// One block of Home: its rows once loaded, and its own Try again.
export type HomeGroup<T> = {
  phase: TodoPhase;
  data: T | null;
  isRetrying: boolean;
  retry: () => void;
};

export type TodoList<T> = { items: T[]; total: number };

export type Freshness = {
  updatedAt: Date | null;
  isStale: boolean;
  isRetrying: boolean;
  retry: () => void;
};

export type HomeData = {
  role: Role;
  isManager: boolean;
  userId: string | null;
  firstName: string | null;
  now: Date;
  today: string;
  chats: HomeGroup<TodoList<Conversation>>;
  bookings: HomeGroup<TodoList<BookingTodoItem>>;
  // Null for Managers: they have no Time off group.
  timeOff: HomeGroup<TodoList<ExceptionRead>> | null;
  todayBookings: HomeGroup<BookingSummary[]>;
  // Null until every block has loaded, and while any of them failed.
  todoCount: number | null;
  freshness: Freshness;
};

type AnyQuery = UseQueryResult<unknown>;

function refetchFailed(queries: AnyQuery[]): void {
  for (const query of queries) {
    if (query.isError) void query.refetch();
  }
}

function getPhase(queries: AnyQuery[]): TodoPhase {
  let phase: TodoPhase = "loading";
  if (queries.every((query) => query.data !== undefined)) {
    phase = "ready";
  } else if (queries.some((query) => query.isError)) {
    phase = "error";
  }
  return phase;
}

function toGroup<T>(queries: AnyQuery[], build: () => T): HomeGroup<T> {
  const phase = getPhase(queries);
  return {
    phase,
    data: phase === "ready" ? build() : null,
    isRetrying: queries.some((query) => query.isError && query.isFetching),
    retry: () => refetchFailed(queries),
  };
}

// The oldest data on screen, and whether a background refresh failed
// while showing it.
function getFreshness(queries: AnyQuery[]): Freshness {
  const loaded = queries.filter((query) => query.data !== undefined);
  const stale = loaded.filter((query) => query.isError);
  const oldest = Math.min(...loaded.map((query) => query.dataUpdatedAt));
  return {
    updatedAt: loaded.length > 0 ? new Date(oldest) : null,
    isStale: stale.length > 0,
    isRetrying: stale.some((query) => query.isFetching),
    retry: () => refetchFailed(stale),
  };
}

export function useHomeData(role: Role): HomeData {
  const userId = useAuthStore((state) => state.userId);
  const isManager = !ADMIN_ROLES.includes(role);
  const now = new Date(useNow());
  const today = getTodayKey(now);

  const me = useQuery(meQueries.detail());
  const chatsQuery = useQuery({
    ...conversationQueries.list({ flagged: true }),
    ...HOME_REFRESH,
  });
  const toSortOut = useQuery({
    // Every page: the API sends oldest first, and the Bookings to change
    // can sit behind any number of unmarked ones.
    ...bookingQueries.week({ to_sort_out: true }),
    ...HOME_REFRESH,
  });
  const needingTutor = useQuery({
    ...childQueries.list({ needs_tutor: true, page_size: TODO_PAGE_SIZE }),
    ...HOME_REFRESH,
  });
  const awaitingEvaluation = useQuery({
    // Not Evaluated and no live Evaluation: what the nav badge counts.
    ...childQueries.list({ evaluable: true, page_size: TODO_PAGE_SIZE }),
    ...HOME_REFRESH,
  });
  const timeOffQuery = useQuery({
    ...timeOffQueries.list({ status: ["pending"], sort: "requested" }),
    ...HOME_REFRESH,
    enabled: !isManager,
  });
  const todayQuery = useQuery({
    ...bookingQueries.week({
      from: today,
      to: today,
      user_id: isManager ? (userId ?? undefined) : undefined,
    }),
    ...HOME_REFRESH,
  });

  const bookingQueriesUsed = [toSortOut, needingTutor, awaitingEvaluation];
  const chats = toGroup([chatsQuery], () => ({
    items: chatsQuery.data?.items ?? [],
    total: chatsQuery.data?.total ?? 0,
  }));
  const bookings = toGroup(bookingQueriesUsed, () => ({
    items: buildBookingTodo(
      toSortOut.data?.items ?? [],
      needingTutor.data?.items ?? [],
      awaitingEvaluation.data?.items ?? [],
    ),
    total:
      (toSortOut.data?.total ?? 0) +
      (needingTutor.data?.total ?? 0) +
      (awaitingEvaluation.data?.total ?? 0),
  }));
  const timeOff = isManager
    ? null
    : toGroup([timeOffQuery], () => ({
        items: timeOffQuery.data?.items ?? [],
        total: timeOffQuery.data?.total ?? 0,
      }));
  const todayBookings = toGroup([todayQuery], () =>
    getTodayOrder(todayQuery.data?.items ?? [], now),
  );

  const todoGroups = [chats, bookings, ...(timeOff ? [timeOff] : [])];
  const isAllReady = [...todoGroups, todayBookings].every(
    (group) => group.phase === "ready",
  );
  const todoCount = isAllReady
    ? todoGroups.reduce((sum, group) => sum + (group.data?.total ?? 0), 0)
    : null;

  return {
    role,
    isManager,
    userId,
    firstName: me.data ? getFirstName(me.data.name) : null,
    now,
    today,
    chats,
    bookings,
    timeOff,
    todayBookings,
    todoCount,
    freshness: getFreshness([
      chatsQuery,
      ...bookingQueriesUsed,
      ...(isManager ? [] : [timeOffQuery]),
      todayQuery,
    ]),
  };
}
