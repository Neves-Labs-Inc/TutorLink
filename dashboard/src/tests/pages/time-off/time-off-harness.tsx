// The real App routes with the network mocked at `lib/api` (each test
// file mocks `api.get` and `api.post` and hands them here): the Time off
// lists, filtered the way the API filters them, one Time off's details,
// the For picker's Staff, and the shell's own reads.
import { AxiosError, AxiosHeaders } from "axios";
import type { AxiosResponse } from "axios";
import type { Mock } from "vitest";
import { App } from "@/App";
import type { Role } from "@/lib/auth/auth";
import type { ExceptionRead, StaffRef } from "@/lib/queries/time-off";
import { useAuthStore } from "@/stores/authStore";
import type { QueryClient } from "@tanstack/react-query";
import {
  createTestQueryClient,
  renderWithProviders,
} from "@/test/render-with-providers";

export const RITA: StaffRef = { id: "u-rita", name: "Rita Souza", role: "admin" };
export const MARCO: StaffRef = { id: "u-marco", name: "Marco Bell", role: "tutor" };
export const ANA: StaffRef = { id: "u-ana", name: "Ana Brooks", role: "manager" };

// Far ahead or long gone, so the tabs hold whatever today is.
export const AHEAD = "2031-10-20";
export const GONE = "2020-01-06";

let nextId = 0;

export function makeTimeOff(overrides: Partial<ExceptionRead> = {}): ExceptionRead {
  nextId += 1;
  return {
    id: `to-${nextId}`,
    staff: MARCO,
    start_date: AHEAD,
    end_date: "2031-10-22",
    start_time: null,
    end_time: null,
    reason: "Family trip",
    status: "pending",
    created_at: "2031-10-14T19:10:00Z",
    decided_by: null,
    decided_at: null,
    cancelled_by: null,
    cancelled_at: null,
    entered_by: { id: MARCO.id, name: MARCO.name },
    clashing_bookings: [],
    clashing_bookings_count: 0,
    ...overrides,
  };
}

export function apiError(status: number): AxiosError {
  const response = {
    status,
    statusText: "",
    data: { detail: "Request failed" },
    headers: {},
    config: { headers: new AxiosHeaders() },
  } as AxiosResponse;
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, response);
}

type ListParams = {
  status?: string[];
  from?: string;
  to?: string;
  page: number;
  page_size: number;
};

// The API's list filters: wire status, and the window overlapping from/to.
function filterList(rows: ExceptionRead[], params: ListParams): ExceptionRead[] {
  return rows.filter(
    (row) =>
      (!params.status?.length || params.status.includes(row.status)) &&
      (params.from === undefined || row.end_date >= params.from) &&
      (params.to === undefined || row.start_date <= params.to),
  );
}

function pageOf(rows: ExceptionRead[], params: ListParams) {
  const start = (params.page - 1) * params.page_size;
  return {
    items: rows.slice(start, start + params.page_size),
    total: rows.length,
    page: params.page,
    page_size: params.page_size,
  };
}

type Network = {
  timeOff?: ExceptionRead[];
  viewer?: StaffRef;
  // Replaces a list read (Admin queue or own list), e.g. to fail or hang it.
  list?: () => Promise<unknown>;
};

const USER_LIST = /^\/api\/users\/([^/]+)\/exceptions$/;

export function respond(
  get: Mock,
  { timeOff = [], viewer = RITA, list }: Network = {},
): void {
  get.mockImplementation(async (url: string, config?: { params?: ListParams }) => {
    const params = config?.params ?? { page: 1, page_size: 20 };
    const ownerId = USER_LIST.exec(url)?.[1];
    let data: unknown;
    if (url === "/api/me") {
      data = { id: viewer.id, email: "me@example.com", role: viewer.role, name: viewer.name };
    } else if (url === "/api/counts") {
      data = null;
    } else if (url === "/api/exceptions") {
      if (list) return { data: await list() };
      data = pageOf(filterList(timeOff, params), params);
    } else if (ownerId !== undefined) {
      if (list) return { data: await list() };
      data = pageOf(timeOff.filter((row) => row.staff.id === ownerId), params);
    } else if (url.startsWith("/api/exceptions/")) {
      const found = timeOff.find((row) => row.id === url.slice("/api/exceptions/".length));
      if (!found) throw apiError(404);
      data = found;
    } else if (url === "/api/staff") {
      data = {
        items: [RITA, MARCO, ANA].map((staff) => ({ ...staff, tutor_id: null })),
        total: 3,
        page: 1,
        page_size: 100,
      };
    } else {
      throw apiError(404);
    }
    return { data };
  });
}

// Every Admin list read sent so far, as the params the API saw.
export function getListReads(get: Mock): ListParams[] {
  return get.mock.calls
    .filter(([url]) => url === "/api/exceptions")
    .map(([, config]) => config.params as ListParams);
}

export function never(): Promise<never> {
  return new Promise(() => {});
}

// Returns the query client, for a test to stand in for a write elsewhere.
export async function renderApp(
  path: string,
  viewer: StaffRef = RITA,
  role: Role = viewer.role,
): Promise<QueryClient> {
  window.history.replaceState(null, "", path);
  useAuthStore.setState({ status: "authenticated", role, userId: viewer.id });
  const client = createTestQueryClient();
  await renderWithProviders(<App />, client);
  return client;
}

export function getPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}
