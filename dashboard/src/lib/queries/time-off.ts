// Time off on the wire, mirroring `api/app/schemas/exceptions.py`. The old
// `lib/queries/exceptions.ts` stays until the old screens go (ticket 12).
import { mutationOptions, queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { BookingStatusWire } from "@/components/kit/components/badges";
import { api, errorStatus, getKeepaliveConfig, warningsOf } from "@/lib/api";
import type { Role } from "@/lib/auth/auth";
import type { Page } from "@/lib/queries/page";

// The stored statuses plus `expired`: a pending row whose window has
// ended. Derived by the API at read time.
export type TimeOffStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired";

export type TimeOffWarningCode = "booking_clash";

export type NamedRef = { id: string; name: string };

export type StaffRef = { id: string; name: string; role: Role };

// A live Booking of the same person inside the window. Computed, never stored.
export type ClashingBooking = {
  booking_id: string;
  date: string;
  start_time: string;
  end_time: string;
  child_name: string;
  status: BookingStatusWire;
};

export type ExceptionRead = {
  id: string;
  // The person holding the Time off.
  staff: StaffRef;
  // Both ends inclusive; a part-day window covers the same hours each day.
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  status: TimeOffStatus;
  created_at: string;
  decided_by: NamedRef | null;
  decided_at: string | null;
  cancelled_by: NamedRef | null;
  cancelled_at: string | null;
  // Who entered the row; null on rows from before it was recorded.
  entered_by: NamedRef | null;
  // Empty unless the status is `pending` (not Expired) or `approved`.
  clashing_bookings: ClashingBooking[];
  clashing_bookings_count: number;
};

// No `status`: the API derives it from the caller's role, so a requester
// can't self-approve by adding a key.
export type ExceptionCreate = {
  start_date: string;
  end_date: string;
  start_time?: string | null;
  end_time?: string | null;
  reason?: string | null;
  confirm_warnings?: TimeOffWarningCode[];
};

export type TimeOffWarning = {
  code: TimeOffWarningCode;
  message: string;
  // The rows `clashing_bookings` would list once the write lands.
  clashing_bookings: ClashingBooking[];
};

// The 409 body an Admin write gets while its clashes are unconfirmed.
export type TimeOffWarningsBody = {
  detail: string;
  warnings: TimeOffWarning[];
};

export type TimeOffDecision = "approved" | "rejected";

// A write that lands, or the clash warning to confirm. The warning is an
// expected answer, not a failure.
export type TimeOffWriteResult =
  | { kind: "saved"; item: ExceptionRead }
  | { kind: "warning"; warnings: TimeOffWarning[] };

export type TimeOffSort = "start" | "requested";

export type TimeOffListParams = {
  status?: TimeOffStatus[];
  user_id?: string;
  // Business dates; the window overlaps them (`end_date >= from`,
  // `start_date <= to`).
  from?: string;
  to?: string;
  sort?: TimeOffSort;
  page?: number;
  page_size?: number;
};

export type UserTimeOffParams = {
  // Oldest first unless "desc".
  order?: "asc" | "desc";
  page?: number;
  page_size?: number;
};

// The filters of a list read whole: every page, gathered.
export type TimeOffListAllParams = Omit<TimeOffListParams, "page" | "page_size">;

const HTTP_CONFLICT = 409;
const NOT_READABLE = new Set([403, 404]);
const MAX_DETAIL_RETRIES = 1;
// The API's largest page (`MAX_PAGE_SIZE`), so a whole list takes the fewest reads.
const WHOLE_LIST_PAGE_SIZE = 100;

// Every Time off query sits under this key, so one invalidation reaches all.
export const TIME_OFF_KEY = ["time-off"] as const;

// Repeat `status` (`?status=a&status=b`) as FastAPI reads a list query.
function serializeParams(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const values: unknown[] = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (item !== undefined) search.append(key, String(item));
    }
  }
  return search.toString();
}

// Reads page 1, then the rest at once, and gathers them as one page.
async function getWholeList(
  getPage: (page: number) => Promise<Page<ExceptionRead>>,
): Promise<Page<ExceptionRead>> {
  const first = await getPage(1);
  const pageCount = Math.ceil(first.total / WHOLE_LIST_PAGE_SIZE);
  const others = await Promise.all(
    Array.from({ length: Math.max(pageCount - 1, 0) }, (_, index) =>
      getPage(index + 2),
    ),
  );
  // A row moving between two reads could land on both pages.
  const byId = new Map(
    [first, ...others].flatMap((page) => page.items).map((item) => [item.id, item]),
  );
  return { ...first, items: [...byId.values()] };
}

export const timeOffQueries = {
  // Every Staff member's Time off (Office only).
  list: (params: TimeOffListParams = {}) =>
    queryOptions({
      queryKey: [...TIME_OFF_KEY, "list", params],
      queryFn: async (): Promise<Page<ExceptionRead>> => {
        const response = await api.get<Page<ExceptionRead>>(
          "/api/exceptions",
          { params, paramsSerializer: serializeParams },
        );
        return response.data;
      },
    }),
  // The whole filtered list, for screens that place, filter and page it
  // themselves. Under `list`, so the optimistic replace reaches it.
  listAll: (params: TimeOffListAllParams = {}) =>
    queryOptions({
      queryKey: [...TIME_OFF_KEY, "list", "all", params],
      queryFn: () =>
        getWholeList(async (page) => {
          const response = await api.get<Page<ExceptionRead>>(
            "/api/exceptions",
            {
              params: { ...params, page, page_size: WHOLE_LIST_PAGE_SIZE },
              paramsSerializer: serializeParams,
            },
          );
          return response.data;
        }),
    }),
  // One person's whole list (own lists are small).
  forUserAll: (userId: string) =>
    queryOptions({
      queryKey: [...TIME_OFF_KEY, "user", userId, "all"],
      queryFn: () =>
        getWholeList(async (page) => {
          const response = await api.get<Page<ExceptionRead>>(
            `/api/users/${userId}/exceptions`,
            { params: { page, page_size: WHOLE_LIST_PAGE_SIZE } },
          );
          return response.data;
        }),
    }),
  // One person's Time off: their own, or anyone's for the Office.
  forUser: (userId: string, params: UserTimeOffParams = {}) =>
    queryOptions({
      queryKey: [...TIME_OFF_KEY, "user", userId, params],
      queryFn: async (): Promise<Page<ExceptionRead>> => {
        const response = await api.get<Page<ExceptionRead>>(
          `/api/users/${userId}/exceptions`,
          { params },
        );
        return response.data;
      },
    }),
  // 403 when it isn't the viewer's to read, 404 when unknown; neither
  // is worth a retry.
  detail: (id: string) =>
    queryOptions({
      queryKey: [...TIME_OFF_KEY, "detail", id],
      queryFn: async (): Promise<ExceptionRead> => {
        const response = await api.get<ExceptionRead>(
          `/api/exceptions/${id}`,
        );
        return response.data;
      },
      retry: (failureCount, error) =>
        !NOT_READABLE.has(errorStatus(error) ?? 0) &&
        failureCount < MAX_DETAIL_RETRIES,
    }),
};

// The clash warning of a refused Admin write, or null for any other
// failure (an already-decided 409 carries no warnings and stays an error).
function readWarnings(error: unknown): TimeOffWarning[] | null {
  if (errorStatus(error) !== HTTP_CONFLICT) return null;
  // Trust boundary: on the Time off routes a 409's `warnings` are
  // `TimeOffWarning`s (api/app/routers/exceptions.py).
  return warningsOf(error) as unknown as TimeOffWarning[] | null;
}

async function writeOrWarn(
  write: () => Promise<ExceptionRead>,
): Promise<TimeOffWriteResult> {
  let result: TimeOffWriteResult;
  try {
    result = { kind: "saved", item: await write() };
  } catch (error) {
    const warnings = readWarnings(error);
    if (warnings === null) throw error;
    result = { kind: "warning", warnings };
  }
  return result;
}

export async function createTimeOff(
  userId: string,
  body: ExceptionCreate,
): Promise<TimeOffWriteResult> {
  return writeOrWarn(async () => {
    const response = await api.post<ExceptionRead>(
      `/api/users/${userId}/exceptions`,
      body,
    );
    return response.data;
  });
}

export async function decideTimeOff(
  id: string,
  decision: TimeOffDecision,
  confirmWarnings: boolean,
): Promise<TimeOffWriteResult> {
  return writeOrWarn(async () => {
    const response = await api.patch<ExceptionRead>(`/api/exceptions/${id}`, {
      status: decision,
      confirm_warnings: confirmWarnings ? ["booking_clash"] : [],
    });
    return response.data;
  });
}

// The deferred send behind Approve and Decline's Undo. Approve confirms
// the clashes the details list; Decline never warns. Any refusal throws,
// so the deferred helper shows its error.
export async function sendTimeOffDecision(
  id: string,
  decision: TimeOffDecision,
  keepalive: boolean,
): Promise<ExceptionRead> {
  const body =
    decision === "approved"
      ? { status: decision, confirm_warnings: ["booking_clash"] }
      : { status: decision };
  const response = await api.patch<ExceptionRead>(
    `/api/exceptions/${id}`,
    body,
    getKeepaliveConfig(keepalive),
  );
  return response.data;
}

export async function cancelTimeOff(id: string): Promise<ExceptionRead> {
  const response = await api.post<ExceptionRead>(
    `/api/exceptions/${id}/cancel`,
  );
  return response.data;
}

// A write moves the Time off lists, a Staff row's `has_pending_time_off`
// and the nav's `time_off_pending` count.
export async function invalidateAfterTimeOffWrite(
  client: QueryClient,
): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: TIME_OFF_KEY }),
    client.invalidateQueries({ queryKey: ["staff"] }),
    client.invalidateQueries({ queryKey: ["counts"] }),
  ]);
}

// Puts `item` in place of its row in the detail and every cached list,
// for an optimistic change and its Undo.
export function replaceCachedTimeOff(client: QueryClient, item: ExceptionRead): void {
  client.setQueryData(timeOffQueries.detail(item.id).queryKey, item);
  const replaceIn = (page: Page<ExceptionRead> | undefined) =>
    page && {
      ...page,
      items: page.items.map((row) => (row.id === item.id ? item : row)),
    };
  client.setQueriesData<Page<ExceptionRead>>(
    { queryKey: [...TIME_OFF_KEY, "list"] },
    replaceIn,
  );
  client.setQueriesData<Page<ExceptionRead>>(
    { queryKey: [...TIME_OFF_KEY, "user"] },
    replaceIn,
  );
}

function storeSaved(client: QueryClient, item: ExceptionRead): void {
  client.setQueryData(timeOffQueries.detail(item.id).queryKey, item);
}

type CreateVariables = { userId: string; body: ExceptionCreate };

type DecideVariables = {
  id: string;
  decision: TimeOffDecision;
  confirmWarnings: boolean;
};

// Settled, not just succeeded: a refused write (409) means the row moved
// under us, so the lists need the fresh state too. Not awaited, so the
// caller hears the outcome without waiting for every refetch.
export const timeOffMutations = {
  create: () =>
    mutationOptions({
      mutationKey: [...TIME_OFF_KEY, "create"],
      mutationFn: ({ userId, body }: CreateVariables) =>
        createTimeOff(userId, body),
      onSuccess: (result, _variables, _onMutate, context) => {
        if (result.kind === "saved") storeSaved(context.client, result.item);
      },
      onSettled: (_data, _error, _variables, _onMutate, context) => {
        void invalidateAfterTimeOffWrite(context.client);
      },
    }),
  decide: () =>
    mutationOptions({
      mutationKey: [...TIME_OFF_KEY, "decide"],
      mutationFn: ({ id, decision, confirmWarnings }: DecideVariables) =>
        decideTimeOff(id, decision, confirmWarnings),
      onSuccess: (result, _variables, _onMutate, context) => {
        if (result.kind === "saved") storeSaved(context.client, result.item);
      },
      onSettled: (_data, _error, _variables, _onMutate, context) => {
        void invalidateAfterTimeOffWrite(context.client);
      },
    }),
  cancel: () =>
    mutationOptions({
      mutationKey: [...TIME_OFF_KEY, "cancel"],
      mutationFn: (id: string) => cancelTimeOff(id),
      onSuccess: (item, _variables, _onMutate, context) =>
        storeSaved(context.client, item),
      onSettled: (_data, _error, _variables, _onMutate, context) => {
        void invalidateAfterTimeOffWrite(context.client);
      },
    }),
};
