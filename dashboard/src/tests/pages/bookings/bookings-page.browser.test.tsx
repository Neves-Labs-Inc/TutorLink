import type { ReactNode } from "react";
import { AxiosError, type AxiosResponse } from "axios";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import BookingOverlaysProvider from "@/components/booking-overlays/booking-overlays-provider";
import { getTodayKey } from "@/components/kit/format";
import KitRoot from "@/components/kit/kit-root";
import type { BookingDetail, BookingSummary } from "@/lib/queries/bookings";
import type { ChildSummary } from "@/lib/queries/children";
import { addDays, addWeeks, getWeekStart } from "@/lib/week";
import BookingsPage from "@/pages/bookings/bookings-page";
import { useAuthStore } from "@/stores/authStore";
import { renderWithProviders } from "@/test/render-with-providers";
import type { RenderResult } from "vitest-browser-react";

const network = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get },
}));

const VIEW_STORAGE_KEY = "tutorlink.bookings.view";
const TODAY = getTodayKey();
const WEEK = getWeekStart(TODAY);
const NEXT_WEEK = addWeeks(WEEK, 1);
const PREVIOUS_WEEK = addWeeks(WEEK, -1);
const TUESDAY = addDays(WEEK, 1);
const WEDNESDAY = addDays(WEEK, 2);

const ANA = { id: "user-ana", name: "Ana Souza", role: "tutor" as const };
const MARIA = {
  id: "user-maria",
  name: "Maria Lopez",
  role: "manager" as const,
};

function makeBooking(overrides: Partial<BookingSummary> = {}): BookingSummary {
  return {
    id: "booking-1",
    child: { id: "child-1", name: "Emma Souza", notes: null },
    staff: ANA,
    kind: "regular",
    location: "home",
    subject: { id: "subject-math", name: "Math" },
    scheduled_date: TUESDAY,
    start_time: "15:30:00",
    end_time: "16:30:00",
    status: "confirmed",
    notes: null,
    updated_at: "2026-10-01T10:00:00",
    office_address: null,
    subject_level: 4,
    home: {
      id: "home-1",
      label: "Main home",
      address: "1 Palm St",
      directions: null,
    },
    guardians: [],
    sort_out_reasons: [],
    clash_acknowledged_by: null,
    clash_acknowledged_at: null,
    ...overrides,
  };
}

function makeDetail(summary: BookingSummary): BookingDetail {
  return {
    ...summary,
    home: summary.home && { ...summary.home, access_code: "" },
    booked_by_guardian: null,
    guardians: [],
    availability_id: null,
    clashing_time_off: [],
    created_at: "2026-09-28T15:00:00Z",
  };
}

function makeChild(
  id: string,
  name: string,
  overrides: Partial<ChildSummary> = {},
): ChildSummary {
  return {
    id,
    name,
    grade_level: 3,
    school_name: "Palm Elementary",
    is_active: true,
    guardians: [{ id: `guardian-${id}`, name: `Guardian of ${name}` }],
    homes: [],
    next_session: null,
    evaluated: null,
    created_at: "2026-10-01T12:00:00Z",
    ...overrides,
  };
}

const EMMA = makeBooking();
const LUCAS = makeBooking({
  id: "booking-2",
  child: { id: "child-2", name: "Lucas Lima", notes: null },
  kind: "evaluation",
  location: "in_office",
  subject: null,
  subject_level: null,
  home: null,
  scheduled_date: WEDNESDAY,
  start_time: "10:00:00",
  end_time: "11:00:00",
  status: "pending",
});
const NOAH = makeBooking({
  id: "booking-3",
  child: { id: "child-3", name: "Noah Reis", notes: null },
  scheduled_date: WEDNESDAY,
  start_time: "13:00:00",
  end_time: "14:00:00",
  status: "cancelled",
});

// GET /api/children/{id} answers for these.
const CHILD_NAMES: Record<string, string> = {
  "child-1": "Emma Souza",
  "child-2": "Lucas Lima",
};

type Page<T> = { items: T[]; total: number; page: number; page_size: number };

type Fixtures = {
  week: BookingSummary[];
  // Overrides the week's total, to page.
  weekTotal?: number;
  toSortOut: BookingSummary[];
  needsTutor: ChildSummary[];
  awaitingEvaluation: ChildSummary[];
  isFailing: boolean;
};

let fixtures: Fixtures;

function pageOf<T>(
  items: T[],
  search: URLSearchParams,
  total = items.length,
): { data: Page<T> } {
  const pageNumber = Number(search.get("page") ?? 1);
  const pageSize = Number(search.get("page_size") ?? 20);
  return { data: { items, total, page: pageNumber, page_size: pageSize } };
}

function failWith(status: number): Promise<never> {
  const response = {
    status,
    data: {},
    headers: {},
    statusText: "",
    config: {},
  } as AxiosResponse;
  return Promise.reject(
    new AxiosError(
      "Request failed",
      String(status),
      undefined,
      undefined,
      response,
    ),
  );
}

type Config = { params?: Record<string, unknown> | URLSearchParams };

async function handleGet(url: string, config: Config = {}): Promise<unknown> {
  const [path, query] = url.split("?");
  const search = new URLSearchParams(query);
  const params = new URLSearchParams(
    config.params instanceof URLSearchParams
      ? config.params
      : Object.entries(config.params ?? {}).map(([key, value]) => [
          key,
          String(value),
        ]),
  );
  if (path === "/api/bookings") {
    if (fixtures.isFailing) return failWith(500);
    if (search.get("to_sort_out") === "true")
      return pageOf(fixtures.toSortOut, search);
    return pageOf(fixtures.week, search, fixtures.weekTotal);
  }
  if (path.startsWith("/api/bookings/")) {
    const id = path.replace("/api/bookings/", "");
    const summary = [...fixtures.week, ...fixtures.toSortOut].find(
      (booking) => booking.id === id,
    );
    return summary ? { data: makeDetail(summary) } : failWith(404);
  }
  const childName = CHILD_NAMES[path.replace("/api/children/", "")];
  if (childName) {
    return {
      data: {
        ...makeChild(path.replace("/api/children/", ""), childName),
        levels: [],
      },
    };
  }
  if (path === "/api/children") {
    if (params.get("needs_tutor") === "true")
      return pageOf(fixtures.needsTutor, params);
    if (params.get("awaiting_evaluation") === "true") {
      return pageOf(fixtures.awaitingEvaluation, params);
    }
    return pageOf([], params);
  }
  if (path === "/api/staff")
    return pageOf(
      [
        { ...ANA, tutor_id: "tutor-ana" },
        { ...MARIA, tutor_id: null },
      ],
      params,
    );
  if (path.startsWith("/api/tutors/")) return pageOf([], params);
  if (path === "/api/exceptions") return pageOf([], params);
  throw new Error(`Unexpected GET ${url}`);
}

function bookingRequests(): URLSearchParams[] {
  return network.get.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith("/api/bookings?"))
    .map((url) => new URLSearchParams(url.split("?")[1]));
}

function lastBookingRequest(): URLSearchParams {
  const requests = bookingRequests();
  return requests[requests.length - 1];
}

// Holds every /api/bookings list answer until the returned release runs.
function holdBookingLists(): () => void {
  const held: (() => void)[] = [];
  network.get.mockImplementation((url: string, config?: Config) =>
    url.startsWith("/api/bookings?")
      ? new Promise((resolve) => {
          held.push(() => resolve(handleGet(url, config)));
        })
      : handleGet(url, config),
  );
  return () => {
    network.get.mockImplementation(handleGet);
    held.forEach((answer) => answer());
  };
}

function LocationProbe(): ReactNode {
  const location = useLocation();
  return (
    <output data-testid="location">{`${location.pathname}${location.search}`}</output>
  );
}

async function renderAt(entry: string): Promise<RenderResult> {
  // px-4: the shell's phone gutter, which the toolbar's sideways scroll bleeds into.
  const element = (
    <div className="px-4">
      <BookingsPage />
      <LocationProbe />
    </div>
  );
  return renderWithProviders(
    <MemoryRouter initialEntries={[entry]}>
      <KitRoot theme="light">
        <BookingOverlaysProvider>
          <Routes>
            <Route path="/bookings/:id?" element={element} />
            <Route path="/families/:memberId" element={<LocationProbe />} />
          </Routes>
        </BookingOverlaysProvider>
      </KitRoot>
    </MemoryRouter>,
  );
}

const location = () => page.getByTestId("location");
const viewSwitch = () => page.getByRole("group", { name: "Bookings view" });

beforeEach(async () => {
  await page.viewport(1280, 800);
  window.localStorage.removeItem(VIEW_STORAGE_KEY);
  useAuthStore.setState({
    status: "authenticated",
    role: "admin",
    userId: "user-rita",
  });
  fixtures = {
    week: [EMMA, LUCAS, NOAH],
    toSortOut: [],
    needsTutor: [],
    awaitingEvaluation: [],
    isFailing: false,
  };
  network.get.mockReset();
  network.get.mockImplementation(handleGet);
});

afterEach(() => {
  window.localStorage.removeItem(VIEW_STORAGE_KEY);
});

describe("Bookings page view", () => {
  it("opens Calendar on the first visit", async () => {
    await renderAt("/bookings");

    await expect
      .element(viewSwitch().getByRole("button", { name: "Calendar" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(page.getByRole("group", { name: "Calendar scale" }))
      .toBeVisible();
  });

  it("remembers List on this device once it is chosen", async () => {
    await renderAt("/bookings");

    await userEvent.click(viewSwitch().getByRole("button", { name: "List" }));

    await expect.element(location()).toHaveTextContent("view=list");
    expect(window.localStorage.getItem(VIEW_STORAGE_KEY)).toBe("list");
  });

  it("opens List on a visit after List was chosen", async () => {
    window.localStorage.setItem(VIEW_STORAGE_KEY, "list");
    await renderAt("/bookings");

    await expect
      .element(viewSwitch().getByRole("button", { name: "List" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(page.getByRole("table", { name: /^Bookings on / }).first())
      .toBeVisible();
  });
});

const LIST = "/bookings?view=list";

async function pickFilter(label: string, option: string): Promise<void> {
  await userEvent.click(page.getByRole("button", { name: label, exact: true }));
  await userEvent.click(page.getByRole("checkbox", { name: option }));
  await userEvent.keyboard("{Escape}");
}

describe("Bookings page filters", () => {
  it("sends search, Kind, Staff and Status as the week's query, and Clear all resets them", async () => {
    await renderAt(LIST);
    await expect
      .element(page.getByRole("table", { name: /^Bookings on / }).first())
      .toBeVisible();

    await userEvent.fill(
      page.getByRole("searchbox", { name: "Search bookings" }),
      "emma",
    );
    await expect.poll(() => lastBookingRequest().get("q")).toBe("emma");
    await pickFilter("Kind", "Evaluation");
    await pickFilter("Staff", "Ana Souza");
    await pickFilter("Status", "Pending");

    await expect
      .poll(() => lastBookingRequest().getAll("status"))
      .toEqual(["pending"]);
    const filtered = lastBookingRequest();
    expect(filtered.get("q")).toBe("emma");
    expect(filtered.getAll("kind")).toEqual(["evaluation"]);
    expect(filtered.getAll("user_id")).toEqual(["user-ana"]);
    expect(filtered.get("from")).toBe(WEEK);
    expect(filtered.get("to")).toBe(addDays(WEEK, 6));
    await expect
      .element(location())
      .toHaveTextContent(
        "/bookings?q=emma&kind=evaluation&staff=user-ana&status=pending&view=list",
      );

    await userEvent.click(page.getByRole("button", { name: "Clear all" }));

    await expect
      .element(location())
      .toHaveTextContent(/^\/bookings\?view=list$/);
    await expect
      .poll(() => lastBookingRequest().toString())
      .not.toContain("status=");
    const cleared = lastBookingRequest();
    expect(cleared.has("q")).toBe(false);
    expect(cleared.has("kind")).toBe(false);
    expect(cleared.has("user_id")).toBe(false);
    await expect
      .element(page.getByRole("searchbox", { name: "Search bookings" }))
      .toHaveValue("");
  });

  it("hides Mine from Admins", async () => {
    await renderAt(LIST);
    await expect
      .element(page.getByRole("button", { name: "Needs attention" }))
      .toBeVisible();
    expect(page.getByRole("button", { name: "Mine" }).query()).toBeNull();
  });

  it("filters a Manager's week to their own Bookings with Mine", async () => {
    useAuthStore.setState({ role: "manager", userId: MARIA.id });
    await renderAt(LIST);

    await userEvent.click(page.getByRole("button", { name: "Mine" }));

    await expect
      .poll(() => lastBookingRequest().getAll("user_id"))
      .toEqual([MARIA.id]);
    await expect.element(location()).toHaveTextContent("mine=1");
  });

  it("preselects the Staff filter from ?staff=", async () => {
    await renderAt("/bookings?staff=user-ana&view=list");

    await expect
      .element(page.getByRole("button", { name: /^Staff.*1 selected$/ }))
      .toBeVisible();
    await expect
      .poll(() => lastBookingRequest()?.getAll("user_id"))
      .toEqual(["user-ana"]);
  });
});

describe("Bookings page week", () => {
  it("moves the week with previous, next and This week", async () => {
    await renderAt(LIST);
    await expect.poll(() => lastBookingRequest()?.get("from")).toBe(WEEK);
    expect(page.getByRole("button", { name: "This week" }).query()).toBeNull();

    await userEvent.click(page.getByRole("button", { name: "Next week" }));
    await expect.poll(() => lastBookingRequest().get("from")).toBe(NEXT_WEEK);
    expect(lastBookingRequest().get("to")).toBe(addDays(NEXT_WEEK, 6));
    await expect.element(location()).toHaveTextContent(`week=${NEXT_WEEK}`);

    await userEvent.click(page.getByRole("button", { name: "This week" }));
    await expect.poll(() => lastBookingRequest().get("from")).toBe(WEEK);
    await expect.element(location()).not.toHaveTextContent("week=");

    await userEvent.click(page.getByRole("button", { name: "Previous week" }));
    await expect
      .poll(() => lastBookingRequest().get("from"))
      .toBe(PREVIOUS_WEEK);
  });

  it("lists the week by day, with the reasons and muted cancelled rows", async () => {
    fixtures.week = [
      EMMA,
      LUCAS,
      NOAH,
      makeBooking({
        id: "booking-4",
        child: { id: "child-4", name: "Mia Costa", notes: null },
        scheduled_date: WEDNESDAY,
        start_time: "09:00:00",
        end_time: "10:00:00",
        sort_out_reasons: ["time_off_clash"],
      }),
    ];
    await renderAt(LIST);

    const wednesday = page.getByRole("table", {
      name: /^Bookings on Wednesday/,
    });
    await expect.element(wednesday).toBeVisible();
    const rows = wednesday.getByRole("row");
    // Header, then by start time.
    await expect
      .element(rows.nth(1))
      .toHaveTextContent(/Mia Costa.*Staff is off/);
    await expect
      .element(rows.nth(2))
      .toHaveTextContent(/Lucas Lima.*Evaluation.*Pending/);
    await expect.element(rows.nth(3)).toHaveTextContent(/Noah Reis.*Cancelled/);
    await expect
      .element(page.getByText("Noah Reis").first())
      .toHaveClass(/line-through/);
  });

  it("opens a row's details", async () => {
    await renderAt(LIST);

    await userEvent.click(
      page.getByRole("button", { name: /^Open Emma Souza/ }).first(),
    );

    await expect
      .element(page.getByRole("dialog", { name: "Booking: Emma Souza" }))
      .toBeVisible();
  });
});

describe("Bookings page states", () => {
  it("shows the skeleton while the week loads", async () => {
    let release: () => void = () => undefined;
    network.get.mockImplementation((url: string, config?: Config) =>
      url.startsWith("/api/bookings?")
        ? new Promise((resolve) => {
            release = () => resolve(handleGet(url, config));
          })
        : handleGet(url, config),
    );
    await renderAt(LIST);

    await expect
      .element(page.getByRole("status", { name: "Loading bookings" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("heading", { name: "Bookings", level: 1 }))
      .toBeVisible();

    release();
    await expect
      .element(page.getByRole("table", { name: /^Bookings on / }).first())
      .toBeVisible();
  });

  it("keeps the error up while Try again loads, then shows the week", async () => {
    fixtures.isFailing = true;
    await renderAt(LIST);
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Couldn’t load bookings");
    fixtures.isFailing = false;
    const release = holdBookingLists();

    await userEvent.click(page.getByRole("button", { name: "Try again" }));

    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Trying again…");
    expect(
      page.getByRole("status", { name: "Loading bookings" }).query(),
    ).toBeNull();
    release();
    await expect
      .element(page.getByRole("table", { name: /^Bookings on / }).first())
      .toBeVisible();
  });

  it("says when the week is empty, and when nothing matches", async () => {
    fixtures.week = [];
    await renderAt(LIST);
    await expect
      .element(page.getByRole("heading", { name: "No bookings this week" }))
      .toBeVisible();

    await pickFilter("Kind", "Tutoring");

    await expect
      .element(page.getByRole("heading", { name: "No bookings match" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Clear all" }))
      .toBeVisible();
  });

  it("pages a long week, keeping the rows while the next page loads", async () => {
    fixtures.weekTotal = 120;
    let release: () => void = () => undefined;
    await renderAt(LIST);
    const pager = page.getByRole("navigation", { name: "Bookings pages" });
    await expect.element(pager).toHaveTextContent("1–50 of 120");

    network.get.mockImplementation((url: string, config?: Config) =>
      url.startsWith("/api/bookings?")
        ? new Promise((resolve) => {
            release = () => resolve(handleGet(url, config));
          })
        : handleGet(url, config),
    );
    await userEvent.click(pager.getByRole("button", { name: "Next" }));

    await expect.poll(() => lastBookingRequest().get("page")).toBe("2");
    await expect
      .element(pager.getByRole("button", { name: "Next" }))
      .toHaveAttribute("aria-disabled", "true");
    await expect
      .element(page.getByRole("table", { name: /^Bookings on / }).first())
      .toBeVisible();
    release();
    await expect.element(pager).toHaveTextContent("51–100 of 120");
    await expect.element(location()).toHaveTextContent("page=2");
  });
});

describe("Bookings page links", () => {
  it("opens /bookings/:id over the page and closes back to /bookings", async () => {
    await renderAt("/bookings/booking-1?view=list");

    const details = page.getByRole("dialog", { name: "Booking: Emma Souza" });
    await expect.element(details).toBeVisible();
    await expect
      .element(location())
      .toHaveTextContent(/^\/bookings\?view=list$/);

    await userEvent.click(details.getByRole("button", { name: "Close" }));

    await expect.element(details).not.toBeInTheDocument();
    await expect
      .element(location())
      .toHaveTextContent(/^\/bookings\?view=list$/);
    await expect
      .element(page.getByRole("heading", { name: "Bookings", level: 1 }))
      .toHaveFocus();
  });
});

describe("Bookings page Needs attention", () => {
  const CLASH = makeBooking({
    id: "booking-clash",
    child: { id: "child-clash", name: "Clara Clash", notes: null },
    scheduled_date: NEXT_WEEK,
    sort_out_reasons: ["time_off_clash"],
  });
  const UNMARKED = makeBooking({
    id: "booking-unmarked",
    child: { id: "child-unmarked", name: "Umberto Unmarked", notes: null },
    scheduled_date: addDays(PREVIOUS_WEEK, 2),
    sort_out_reasons: ["not_completed"],
  });
  const NEEDS_TUTOR = makeChild("child-tutor", "Tina Tutorless", {
    levels: [{ subject_id: "subject-math", name: "Math", level: 3 }],
  });
  const WAITING = makeChild("child-waiting", "Walter Waiting");

  beforeEach(() => {
    fixtures.toSortOut = [UNMARKED, CLASH];
    fixtures.needsTutor = [NEEDS_TUTOR];
    fixtures.awaitingEvaluation = [WAITING];
  });

  it("lists To do's Bookings in To do's order across every date", async () => {
    await renderAt("/bookings?needs_attention=1");

    const table = page.getByRole("table", {
      name: "Bookings that need attention",
    });
    await expect.element(table).toBeVisible();
    const rows = table.getByRole("row");
    await expect
      .element(rows.nth(1))
      .toHaveTextContent(/Clara Clash.*Staff is off.*Ana Souza/);
    await expect
      .element(rows.nth(2))
      .toHaveTextContent(/Tina Tutorless.*Math Grade 3.*Needs a Tutor/);
    await expect
      .element(rows.nth(3))
      .toHaveTextContent(/Umberto Unmarked.*Not marked/);
    await expect
      .element(rows.nth(4))
      .toHaveTextContent(/Walter Waiting.*Evaluation to book/);

    const toSortOut = bookingRequests().find(
      (request) => request.get("to_sort_out") === "true",
    );
    expect(toSortOut?.has("from")).toBe(false);
    expect(toSortOut?.has("to")).toBe(false);
    await expect
      .element(
        page.getByRole("heading", { name: "All dates · needs attention" }),
      )
      .toBeVisible();
    expect(page.getByRole("searchbox").query()).toBeNull();
    expect(
      page.getByRole("group", { name: "Bookings view" }).query(),
    ).toBeNull();
    expect(page.getByRole("button", { name: "Next week" }).query()).toBeNull();
    expect(
      page.getByRole("button", { name: "Kind", exact: true }).query(),
    ).toBeNull();
  });

  it("opens a Booking row's details", async () => {
    await renderAt("/bookings?needs_attention=1");

    await userEvent.click(
      page.getByRole("button", { name: /^Open Clara Clash/ }).first(),
    );

    await expect
      .element(page.getByRole("dialog", { name: "Booking: Clara Clash" }))
      .toBeVisible();
  });

  it("takes a Needs a Tutor row to the family", async () => {
    await renderAt("/bookings?needs_attention=1");

    await userEvent.click(
      page
        .getByRole("button", { name: "Open Tina Tutorless · Needs a Tutor" })
        .first(),
    );

    await expect
      .element(location())
      .toHaveTextContent("/families/child-tutor?child=child-tutor");
  });

  it("starts New booking for an Evaluation row", async () => {
    await renderAt("/bookings?needs_attention=1");

    await userEvent.click(
      page.getByRole("button", { name: /^Open Walter Waiting · / }).first(),
    );

    await expect
      .element(page.getByRole("dialog", { name: "New booking" }))
      .toBeVisible();
  });

  it("forces List even when Calendar was chosen, and Clear all turns it off", async () => {
    await renderAt("/bookings?needs_attention=1&view=calendar");
    await expect
      .element(
        page.getByRole("table", { name: "Bookings that need attention" }),
      )
      .toBeVisible();

    await userEvent.click(page.getByRole("button", { name: "Clear all" }));

    await expect
      .element(location())
      .toHaveTextContent(/^\/bookings\?view=calendar$/);
    await expect
      .element(page.getByRole("group", { name: "Calendar scale" }))
      .toBeVisible();
  });

  it("pages a long list in the browser", async () => {
    fixtures.awaitingEvaluation = Array.from({ length: 23 }, (_, index) =>
      makeChild(`child-${index}`, `Waiting Child ${index}`),
    );
    await renderAt("/bookings?needs_attention=1");
    const pager = page.getByRole("navigation", {
      name: "Needs attention pages",
    });
    await expect.element(pager).toHaveTextContent("1–20 of 26");

    await userEvent.click(pager.getByRole("button", { name: "Next" }));

    await expect.element(pager).toHaveTextContent("21–26 of 26");
    await expect.element(location()).toHaveTextContent("page=2");
    const rows = page
      .getByRole("table", { name: "Bookings that need attention" })
      .getByRole("row");
    // Header plus the last six.
    await expect.poll(() => rows.all().length).toBe(7);
  });

  it("says when nothing needs attention", async () => {
    fixtures.toSortOut = [];
    fixtures.needsTutor = [];
    fixtures.awaitingEvaluation = [];
    await renderAt("/bookings?needs_attention=1");

    await expect
      .element(page.getByRole("heading", { name: "Nothing needs attention" }))
      .toBeVisible();
    expect(
      page.getByRole("button", { name: "Show all bookings" }).query(),
    ).toBeNull();
  });
});

describe("Bookings page on a phone", () => {
  it("fits 375px without sideways page scroll, with a round New booking", async () => {
    await page.viewport(375, 812);
    await renderAt(LIST);
    await expect
      .element(page.getByRole("list", { name: /^Bookings on / }).first())
      .toBeVisible();

    const scroller = document.querySelector<HTMLElement>("[data-kit-scroll]");
    expect(scroller?.scrollWidth).toBeLessThanOrEqual(
      scroller?.clientWidth ?? 0,
    );
    const newBooking = page
      .getByRole("button", { name: "New booking" })
      .elements();
    const shown = newBooking.filter(
      (element) =>
        element instanceof HTMLElement && element.offsetParent !== null,
    );
    expect(shown).toHaveLength(1);
    expect(shown[0].textContent?.trim()).toBe("");
  });
});

describe("Bookings page Child filter", () => {
  const childButton = () =>
    page.getByRole("button", { name: /^Emma Souza.*1 selected$/ });

  it("filters the week to one Child from ?child= and keeps it across views", async () => {
    await renderAt("/bookings?child=child-1&view=list");

    await expect.element(childButton()).toBeVisible();
    await expect
      .poll(() => lastBookingRequest()?.getAll("child_id"))
      .toEqual(["child-1"]);

    await userEvent.click(
      viewSwitch().getByRole("button", { name: "Calendar" }),
    );

    await expect.element(location()).toHaveTextContent("child=child-1");
    await expect.element(location()).toHaveTextContent("view=calendar");
    await expect
      .poll(() => lastBookingRequest().getAll("child_id"))
      .toEqual(["child-1"]);
  });

  it("filters to two Children, named in the filter, and drops one when unticked", async () => {
    await renderAt("/bookings?child=child-1&child=child-2&view=list");

    const button = page.getByRole("button", {
      name: /^Emma Souza, Lucas Lima.*2 selected$/,
    });
    await expect.element(button).toBeVisible();
    await expect
      .poll(() => lastBookingRequest()?.getAll("child_id"))
      .toEqual(["child-1", "child-2"]);

    await userEvent.click(button);
    await userEvent.click(page.getByRole("checkbox", { name: "Lucas Lima" }));
    await userEvent.keyboard("{Escape}");

    await expect
      .poll(() => lastBookingRequest().getAll("child_id"))
      .toEqual(["child-1"]);
    await expect.element(location()).not.toHaveTextContent("child=child-2");
  });

  it("clears the Child filter with Clear all", async () => {
    await renderAt("/bookings?child=child-1&view=list");
    await expect.element(childButton()).toBeVisible();

    await userEvent.click(page.getByRole("button", { name: "Clear all" }));

    await expect
      .element(location())
      .toHaveTextContent(/^\/bookings\?view=list$/);
    await expect.poll(() => lastBookingRequest().has("child_id")).toBe(false);
    expect(childButton().query()).toBeNull();
  });
});

describe("Bookings page round 2", () => {
  const LONG_CHILD = "Maria Eduarda Fernandes de Albuquerque Cavalcanti Souza";
  const LONG_STAFF = "Ana Beatriz Rodrigues de Oliveira Nascimento";

  it("keeps long names inside the day table's card", async () => {
    fixtures.week = [
      makeBooking({
        child: { id: "child-long", name: LONG_CHILD, notes: null },
        staff: { ...ANA, name: LONG_STAFF },
        sort_out_reasons: ["time_off_clash", "not_completed"],
        status: "pending",
      }),
    ];
    await renderAt(LIST);
    const table = page.getByRole("table", { name: /^Bookings on / });
    await expect.element(table).toBeVisible();

    const card = table.element().parentElement as HTMLElement;
    expect(table.element().scrollWidth).toBeLessThanOrEqual(card.clientWidth);
  });

  it("keeps long names inside the Needs attention card", async () => {
    fixtures.toSortOut = [
      makeBooking({
        child: { id: "child-long", name: LONG_CHILD, notes: null },
        staff: { ...ANA, name: LONG_STAFF },
        sort_out_reasons: ["time_off_clash"],
      }),
    ];
    await renderAt("/bookings?needs_attention=1");
    const table = page.getByRole("table", {
      name: "Bookings that need attention",
    });
    await expect.element(table).toBeVisible();

    const card = table.element().parentElement as HTMLElement;
    expect(table.element().scrollWidth).toBeLessThanOrEqual(card.clientWidth);
  });

  it("strikes cancelled rows on phones", async () => {
    await page.viewport(375, 812);
    await renderAt(LIST);
    const rows = page.getByRole("list", { name: /^Bookings on Wednesday/ });
    await expect.element(rows).toBeVisible();

    const noah = rows.getByText("Noah Reis").element();
    expect(getComputedStyle(noah).textDecorationLine).toBe("line-through");
    const lucas = rows.getByText("Lucas Lima").element();
    expect(getComputedStyle(lucas).textDecorationLine).toBe("none");
  });

  it("keeps Needs attention's error up while Try again loads", async () => {
    fixtures.isFailing = true;
    await renderAt("/bookings?needs_attention=1");
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Couldn’t load bookings");
    fixtures.isFailing = false;
    const release = holdBookingLists();

    await userEvent.click(page.getByRole("button", { name: "Try again" }));

    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Trying again…");
    release();
    await expect
      .element(page.getByRole("heading", { name: "Nothing needs attention" }))
      .toBeVisible();
  });

  it("snaps ?week= to that week's Monday", async () => {
    await renderAt(`/bookings?view=list&week=${addDays(NEXT_WEEK, 2)}`);

    await expect.poll(() => lastBookingRequest()?.get("from")).toBe(NEXT_WEEK);
    expect(lastBookingRequest().get("to")).toBe(addDays(NEXT_WEEK, 6));
  });

  it("shows the last page when the page asked for is past the end", async () => {
    fixtures.awaitingEvaluation = Array.from({ length: 3 }, (_, index) =>
      makeChild(`child-${index}`, `Waiting Child ${index}`),
    );
    await renderAt("/bookings?needs_attention=1&page=4");

    const table = page.getByRole("table", {
      name: "Bookings that need attention",
    });
    await expect.element(table).toHaveTextContent("Waiting Child 0");
  });

  it("moves a list page past the end back to the last page", async () => {
    fixtures.weekTotal = 60;
    fixtures.week = [];
    network.get.mockImplementation((url: string, config?: Config) => {
      const search = new URLSearchParams(url.split("?")[1]);
      if (url.startsWith("/api/bookings?") && search.get("page") === "2") {
        return pageOf([EMMA], search, 60);
      }
      return handleGet(url, config);
    });
    await renderAt("/bookings?view=list&page=5");

    await expect.element(location()).toHaveTextContent("page=2");
    await expect
      .element(page.getByRole("table", { name: /^Bookings on / }).first())
      .toBeVisible();
  });

  it("encodes ids from the URL in API paths and honours at most 20 Children", async () => {
    const ids = Array.from({ length: 25 }, (_, index) => `child-${index}`);
    await renderAt(
      `/bookings/${encodeURIComponent("../stats")}?view=list&${ids
        .map((id) => `child=${id}`)
        .join("&")}`,
    );

    await expect
      .poll(() => lastBookingRequest()?.getAll("child_id").length)
      .toBe(20);
    const paths = network.get.mock.calls.map(([url]) => String(url));
    expect(paths).toContain("/api/bookings/..%2Fstats");
    expect(
      paths.filter((path) => path.startsWith("/api/children/")),
    ).toHaveLength(20);
  });
});
