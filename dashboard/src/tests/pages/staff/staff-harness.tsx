// The real App routes with the network mocked at `lib/api` (each test
// file mocks `api.get` and hands it here): Staff rows, a teaching
// profile for the `/tutors/:id` redirect, and the shell's own reads.
import { AxiosError, AxiosHeaders } from "axios";
import type { AxiosResponse } from "axios";
import type { Mock } from "vitest";
import { App } from "@/App";
import type { Role } from "@/lib/auth/auth";
import type { StaffRead } from "@/lib/queries/staff";
import { useAuthStore } from "@/stores/authStore";
import { renderWithProviders } from "@/test/render-with-providers";

export const VIEWER_ID = "u-rita";
const DAY_MS = 86_400_000;

export function makeStaff(overrides: Partial<StaffRead> = {}): StaffRead {
  return {
    id: "u-ana",
    name: "Ana Brooks",
    role: "tutor",
    tutor_id: "t-ana",
    email: "ana@example.com",
    sign_in_state: "active",
    invite_expires_at: null,
    archived: false,
    subjects: [
      { id: "s-maths", name: "Maths", max_grade_level: 8 },
      { id: "s-reading", name: "Reading", max_grade_level: 0 },
    ],
    sessions_this_week: 4,
    assigned_children: [],
    phone_number: "+13055550142",
    bio: null,
    has_pending_time_off: true,
    ...overrides,
  };
}

export const ANA = makeStaff();
export const RITA = makeStaff({
  id: VIEWER_ID,
  name: "Rita Souza",
  role: "admin",
  tutor_id: null,
  email: "rita@example.com",
  subjects: [],
  phone_number: null,
  sessions_this_week: 1,
  has_pending_time_off: false,
});
export const DAN = makeStaff({
  id: "u-dan",
  name: "Dan Moss",
  role: "admin",
  tutor_id: null,
  email: "dan@example.com",
  sign_in_state: "invited",
  invite_expires_at: new Date(Date.now() + 3 * DAY_MS).toISOString(),
  subjects: [],
  phone_number: null,
  has_pending_time_off: false,
});
export const MO = makeStaff({
  id: "u-mo",
  name: "Mo Lima",
  role: "manager",
  tutor_id: "t-mo",
  email: "mo@example.com",
  sign_in_state: "not_invited",
  subjects: [],
  phone_number: null,
  has_pending_time_off: false,
});
export const ZOE = makeStaff({
  id: "u-zoe",
  name: "Zoe Park",
  email: "zoe@example.com",
  archived: true,
  has_pending_time_off: false,
});

type StaffParams = { archived: boolean; roles: string[]; states: string[]; q: string };

// The list query sends URLSearchParams; the tab counts send a plain object.
function readStaffParams(params: unknown): StaffParams {
  const search =
    params instanceof URLSearchParams
      ? params
      : new URLSearchParams(Object.entries(params as Record<string, string>));
  return {
    archived: search.get("archived") === "true",
    roles: search.getAll("role"),
    states: search.getAll("sign_in_state"),
    q: (search.get("q") ?? "").toLowerCase(),
  };
}

function filterStaff(rows: StaffRead[], params: StaffParams): StaffRead[] {
  return rows.filter(
    (staff) =>
      staff.archived === params.archived &&
      (params.roles.length === 0 || params.roles.includes(staff.role)) &&
      (params.states.length === 0 ||
        params.states.includes(staff.sign_in_state)) &&
      staff.name.toLowerCase().includes(params.q),
  );
}

export function notFound(status = 404): AxiosError {
  const response = {
    status,
    statusText: "Not Found",
    data: { detail: "Staff member not found" },
    headers: {},
    config: { headers: new AxiosHeaders() },
  } as AxiosResponse;
  return new AxiosError("Not found", "ERR_BAD_REQUEST", undefined, undefined, response);
}

type Network = {
  staff?: StaffRead[];
  // Replaces the Staff list read, e.g. to fail or hang it.
  list?: () => Promise<unknown>;
  detail?: (id: string) => Promise<unknown>;
};

export function respond(
  get: Mock,
  { staff = [ANA, RITA, DAN, MO, ZOE], list, detail }: Network = {},
): void {
  get.mockImplementation(async (url: string, config?: { params?: unknown }) => {
    let data: unknown;
    if (url === "/api/me") {
      data = { id: VIEWER_ID, email: RITA.email, role: "admin", name: RITA.name };
    } else if (url === "/api/counts") {
      data = null;
    } else if (url === "/api/staff") {
      const params = readStaffParams(config?.params);
      const isCount = !(config?.params instanceof URLSearchParams);
      if (list && !isCount) return { data: await list() };
      const items = filterStaff(staff, params);
      data = { items, total: items.length, page: 1, page_size: 100 };
    } else if (url.startsWith("/api/staff/")) {
      const id = url.slice("/api/staff/".length);
      if (detail) return { data: await detail(id) };
      const found = staff.find((row) => row.id === id);
      if (!found) throw notFound();
      data = found;
    } else if (url === "/api/tutors/t-ana") {
      data = { id: "t-ana", user_id: ANA.id };
    } else {
      throw notFound();
    }
    return { data };
  });
}

// Every Staff list read sent so far, as the params the API saw.
export function getListReads(get: Mock): URLSearchParams[] {
  return get.mock.calls
    .filter(([url, config]) => url === "/api/staff" && config?.params instanceof URLSearchParams)
    .map(([, config]) => config.params as URLSearchParams);
}

export function never(): Promise<never> {
  return new Promise(() => {});
}

export async function renderApp(path: string, role: Role = "admin"): Promise<void> {
  window.history.replaceState(null, "", path);
  useAuthStore.setState({ status: "authenticated", role, userId: VIEWER_ID });
  await renderWithProviders(<App />);
}

export function getPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}
