import { focusManager } from "@tanstack/react-query";
import { AxiosError, AxiosHeaders } from "axios";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import KitRoot from "@/components/kit/kit-root";
import { BookingOverlaysContext } from "@/hooks/use-booking-overlays";
import type { BookingOverlays } from "@/hooks/use-booking-overlays";
import type { Role } from "@/lib/auth/auth";
import type { BookingSummary } from "@/lib/queries/bookings";
import type { ChildSummary } from "@/lib/queries/children";
import type { Conversation } from "@/lib/queries/conversations";
import type { Page } from "@/lib/queries/page";
import type { ExceptionRead } from "@/lib/queries/time-off";
import HomePage from "@/pages/home/home-page";
import { useAuthStore } from "@/stores/authStore";
import { renderWithProviders } from "@/test/render-with-providers";

// 1:10 PM on Thursday, October 15 2026 in New York.
const NOW = new Date("2026-10-15T17:10:00Z");
const ONE_MINUTE_LATER = new Date("2026-10-15T17:11:00Z");
const TODAY = "2026-10-15";
const USER_ID = "u-maria";

const network = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get },
}));

function toPage<T>(items: T[], total: number = items.length): Page<T> {
  return { items, total, page: 1, page_size: 20 };
}

function makeChat(id: string, name: string): Conversation {
  return {
    id,
    phone_number: "+13055550142",
    guardian: { id: `g-${id}`, name },
    status: "bot",
    taken_over_by: null,
    last_message_at: "2026-10-15T15:00:00Z",
    last_message_preview: `Message from ${name}`,
    unread: true,
    flag_reason: "booking_request",
    intake_in_progress: false,
    // Two hours ago: the window has 22h left.
    last_client_message_at: "2026-10-15T15:10:00Z",
    is_window_open: true,
    flagged_at: "2026-10-15T15:10:00Z",
  };
}

function makeBooking(
  id: string,
  childName: string,
  overrides: Partial<BookingSummary>,
): BookingSummary {
  return {
    id,
    child: { id: `c-${id}`, name: childName, notes: null },
    staff: { id: "u-ana", name: "Ana Souza", role: "tutor" },
    kind: "regular",
    location: "home",
    subject: { id: "sub-math", name: "Math" },
    subject_level: 3,
    scheduled_date: TODAY,
    start_time: "15:30:00",
    end_time: "16:30:00",
    status: "confirmed",
    notes: null,
    updated_at: "2026-10-01T12:00:00Z",
    office_address: null,
    home: {
      id: "h-1",
      label: "Main home",
      address: "12 Oak St, Doral",
      directions: null,
    },
    guardians: [{ id: "g-1", name: "Laura Souza" }],
    sort_out_reasons: [],
    clash_acknowledged_by: null,
    clash_acknowledged_at: null,
    ...overrides,
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
    school_name: "Lincoln Elementary",
    is_active: true,
    guardians: [{ id: `g-${id}`, name: "Diana Souza" }],
    homes: [],
    next_session: null,
    evaluated: null,
    levels: [],
    created_at: "2026-10-01T12:00:00Z",
    ...overrides,
  };
}

function makeTimeOff(
  id: string,
  name: string,
  overrides: Partial<ExceptionRead> = {},
): ExceptionRead {
  return {
    id,
    staff: { id: `u-${id}`, name, role: "tutor" },
    start_date: "2026-10-22",
    end_date: "2026-10-23",
    start_time: null,
    end_time: null,
    reason: "Family trip",
    status: "pending",
    created_at: "2026-10-10T12:00:00Z",
    decided_by: null,
    decided_at: null,
    cancelled_by: null,
    cancelled_at: null,
    entered_by: null,
    clashing_bookings: [],
    clashing_bookings_count: 0,
    ...overrides,
  };
}

const CHATS = toPage(
  [
    makeChat("ch-1", "Diana Souza"),
    makeChat("ch-2", "Pedro Lima"),
    makeChat("ch-3", "Rosa Diaz"),
    makeChat("ch-4", "Tom Hill"),
  ],
  4,
);

const NOT_MARKED = makeBooking("b-unmarked", "Noah Unmarked", {
  scheduled_date: "2026-10-12",
  start_time: "10:00:00",
  end_time: "11:00:00",
  sort_out_reasons: ["not_completed"],
});
const CLASH = makeBooking("b-clash", "Clara Clash", {
  scheduled_date: "2026-10-22",
  sort_out_reasons: ["time_off_clash"],
});
const SORT_OUT = toPage([NOT_MARKED, CLASH]);
const NEEDS_TUTOR = toPage([
  makeChild("c-leo", "Leo Tutorless", {
    evaluated: { at: "2026-10-01T12:00:00Z", by: { id: "u-1", name: "Admin" } },
    levels: [
      { subject_id: "s-1", name: "Math", level: 3 },
      { subject_id: "s-2", name: "Reading", level: 2 },
    ],
  }),
]);
const AWAITING = toPage([
  makeChild("c-eve", "Eve Newer", { created_at: "2026-10-15T12:00:00Z" }),
  makeChild("c-dia", "Dia Waiting", {
    created_at: "2026-10-03T12:00:00Z",
    homes: [
      { id: "h-9", label: null, address: "9 Palm Ave, Doral", is_active: true },
    ],
  }),
]);
const TIME_OFF = toPage([
  makeTimeOff("t-1", "Ana Souza", { clashing_bookings_count: 2 }),
  makeTimeOff("t-2", "Bea Manager", {
    staff: { id: "u-bea", name: "Bea Manager", role: "manager" },
  }),
]);
const TODAY_BOOKINGS = toPage([
  makeBooking("b-later", "Lia Later", {
    start_time: "15:30:00",
    end_time: "16:30:00",
  }),
  makeBooking("b-past", "Paul Past", {
    start_time: "09:00:00",
    end_time: "10:00:00",
    status: "completed",
  }),
  makeBooking("b-now", "Nina Now", {
    start_time: "13:00:00",
    end_time: "14:00:00",
    kind: "evaluation",
    subject: null,
  }),
  makeBooking("b-cancelled", "Carl Cancelled", {
    start_time: "16:00:00",
    end_time: "17:00:00",
    status: "cancelled",
  }),
]);

type Source =
  | "me"
  | "chats"
  | "sortOut"
  | "needsTutor"
  | "awaiting"
  | "timeOff"
  | "today";

// `search` is the request's query string (Bookings) or its params (the rest).
type Handler = (search: URLSearchParams) => Promise<unknown>;

const ok = (data: unknown): Handler => () => Promise.resolve(data);
const never: Handler = () => new Promise(() => {});

function httpError(status: number): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError(String(status), "ERR_BAD_RESPONSE", config, null, {
    status,
    statusText: String(status),
    headers: {},
    config,
    data: { detail: "Server error" },
  });
}

const fail: Handler = () => Promise.reject(httpError(500));

let handlers: Record<Source, Handler>;
let requests: string[];

type RequestConfig = { params?: Record<string, unknown> };

function getSource(url: string, config: RequestConfig = {}): Source | null {
  const params = config.params ?? {};
  let source: Source | null = null;
  if (url === "/api/me") {
    source = "me";
  } else if (url === "/api/conversations" && params.flagged === true) {
    source = "chats";
  } else if (url.startsWith("/api/bookings?")) {
    const search = new URLSearchParams(url.split("?")[1]);
    source = search.get("to_sort_out") === "true" ? "sortOut" : "today";
  } else if (url === "/api/children" && params.needs_tutor === true) {
    source = "needsTutor";
  } else if (url === "/api/children" && params.evaluable === true) {
    source = "awaiting";
  } else if (url === "/api/exceptions") {
    source = "timeOff";
  }
  return source;
}

async function handleGet(url: string, config?: RequestConfig): Promise<unknown> {
  requests.push(url);
  const source = getSource(url, config);
  if (source === null) throw httpError(404);
  const search = url.includes("?")
    ? new URLSearchParams(url.split("?")[1])
    : new URLSearchParams(
        Object.entries(config?.params ?? {}).map(([key, value]) => [key, String(value)]),
      );
  return { data: await handlers[source](search) };
}

const overlays: BookingOverlays = {
  openBooking: vi.fn(),
  openNewBooking: vi.fn(),
  openChangeBooking: vi.fn(),
};

function LocationProbe(): ReactNode {
  const location = useLocation();
  return (
    <output data-testid="location">{`${location.pathname}${location.search}`}</output>
  );
}

async function renderHome(role: Role): Promise<void> {
  useAuthStore.setState({ status: "authenticated", role, userId: USER_ID });
  await renderWithProviders(
    <MemoryRouter initialEntries={["/home"]}>
      <KitRoot theme="light" height="800px">
        <BookingOverlaysContext value={overlays}>
          <Routes>
            <Route path="/home" element={<HomePage />} />
            <Route path="*" element={null} />
          </Routes>
        </BookingOverlaysContext>
      </KitRoot>
      <LocationProbe />
    </MemoryRouter>,
  );
}

const location = () => page.getByTestId("location");
const card = (title: string) =>
  page.getByRole("region", { name: title, exact: true });

function refocusWindow(): void {
  focusManager.setFocused(false);
  focusManager.setFocused(true);
}

beforeEach(async () => {
  await page.viewport(1280, 900);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  requests = [];
  handlers = {
    me: ok({ id: USER_ID, name: "Maria Lopes", role: "admin" }),
    chats: ok(CHATS),
    sortOut: ok(SORT_OUT),
    needsTutor: ok(NEEDS_TUTOR),
    awaiting: ok(AWAITING),
    timeOff: ok(TIME_OFF),
    today: ok(TODAY_BOOKINGS),
  };
  network.get.mockReset();
  network.get.mockImplementation(handleGet);
});

afterEach(() => {
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

describe("Welcome card", () => {
  it("shows the role's card under the header while the welcome is unseen", async () => {
    handlers.me = ok({ id: USER_ID, name: "Maria Lopes", role: "admin", welcome_seen: false });
    await renderHome("admin");

    await expect
      .element(page.getByRole("region", { name: "Welcome to TutorLink" }))
      .toBeVisible();
  });
});

describe("Home groups by role", () => {
  it("gives an Admin Chats, Bookings and Time off, with the day's summary", async () => {
    await renderHome("admin");

    await expect.element(page.getByText("Thursday, October 15")).toBeVisible();
    await expect
      .element(page.getByRole("heading", { level: 1, name: "Good afternoon, Maria" }))
      .toBeVisible();
    // 4 chats + 5 Booking jobs + 2 Time off; cancelled ones aren't counted today.
    await expect
      .element(page.getByText("11 things in To do, 3 bookings today."))
      .toBeVisible();
    await expect.element(card("Chats")).toBeVisible();
    await expect.element(card("Bookings")).toBeVisible();
    await expect.element(card("Time off")).toBeVisible();
    await expect
      .element(page.getByRole("heading", { level: 2, name: "Today’s bookings" }))
      .toBeVisible();
  });

  it("gives a Manager Chats and Bookings, and never asks for Time off", async () => {
    await renderHome("manager");

    await expect
      .element(page.getByText("9 things in To do, 3 sessions today."))
      .toBeVisible();
    await expect.element(card("Chats")).toBeVisible();
    await expect.element(card("Bookings")).toBeVisible();
    expect(card("Time off").query()).toBeNull();
    expect(requests.some((url) => url.startsWith("/api/exceptions"))).toBe(false);
    await expect
      .element(page.getByRole("heading", { level: 2, name: "My sessions today" }))
      .toBeVisible();
    expect(page.getByRole("button", { name: "Open Bookings" }).query()).toBeNull();
  });

  it("asks only for the Manager's own sessions today", async () => {
    await renderHome("manager");

    await expect.element(page.getByText("Nina Now")).toBeVisible();
    const todayUrl = requests.find((url) => url.includes(`from=${TODAY}`));
    const search = new URLSearchParams(todayUrl?.split("?")[1]);
    expect(search.get("user_id")).toBe(USER_ID);
    expect(search.get("to")).toBe(TODAY);
  });
});

describe("To do cards", () => {
  it("shows at most 3 rows per card and See all with the API total", async () => {
    await renderHome("admin");

    const chats = card("Chats");
    await expect.element(chats.getByRole("link", { name: /Diana Souza/ })).toBeVisible();
    expect(chats.getByRole("listitem").all()).toHaveLength(3);
    expect(chats.getByText("Tom Hill").query()).toBeNull();
    await expect
      .element(chats.getByRole("button", { name: "See all 4 chats that need attention" }))
      .toBeVisible();
    await expect
      .element(card("Bookings").getByRole("button", { name: /^See all 5 / }))
      .toBeVisible();
    await expect
      .element(card("Time off").getByRole("button", { name: /^See all 2 / }))
      .toBeVisible();
  });

  it.each([
    ["Chats", 4, "/chats"],
    ["Bookings", 5, "/bookings?needs_attention=1"],
    ["Time off", 2, "/time-off"],
  ])("sends %s's See all to its page", async (title, total, path) => {
    await renderHome("admin");

    await card(title)
      .getByRole("button", { name: new RegExp(`^See all ${total} `) })
      .click();
    await expect.element(location()).toHaveTextContent(path);
  });

  it("orders Bookings as To do does, each row opening its own target", async () => {
    await renderHome("admin");

    const bookings = card("Bookings");
    await expect.element(bookings.getByText("Clara Clash")).toBeVisible();
    const rows = bookings.getByRole("listitem").all();
    expect(rows.map((row) => row.element().textContent)).toEqual([
      expect.stringContaining("Clara Clash"),
      expect.stringContaining("Leo Tutorless"),
      expect.stringContaining("Noah Unmarked"),
    ]);
    await expect.element(bookings.getByText("Staff is off")).toBeVisible();
    await expect
      .element(bookings.getByText("Thu, Oct 22, 3:30 PM · Ana Souza"))
      .toBeVisible();
    await expect
      .element(bookings.getByText("No Assigned Tutors · Math, Reading"))
      .toBeVisible();

    await bookings.getByRole("button", { name: /Clara Clash/ }).click();
    expect(overlays.openBooking).toHaveBeenCalledWith("b-clash");

    await expect
      .element(bookings.getByRole("link", { name: /Leo Tutorless/ }))
      .toHaveAttribute("href", "/families/c-leo?child=c-leo");
  });

  it("opens an Evaluation to book in Home's overlay, whose Book evaluation opens the form", async () => {
    handlers.sortOut = ok(toPage([]));
    handlers.needsTutor = ok(toPage([]));
    await renderHome("admin");

    const bookings = card("Bookings");
    // Longest waiting first.
    await expect
      .element(bookings.getByText("Waiting 12 days · Diana Souza"))
      .toBeVisible();
    await expect.element(bookings.getByText("New today · Diana Souza")).toBeVisible();
    await bookings.getByRole("button", { name: /Dia Waiting/ }).click();

    const overlay = page.getByRole("dialog", { name: /Dia Waiting/ });
    await expect.element(overlay.getByRole("heading", { name: "Dia Waiting" })).toBeVisible();
    await expect.element(overlay.getByText("Waiting 12 days")).toBeVisible();
    await expect.element(overlay.getByText("9 Palm Ave, Doral")).toBeVisible();
    await expect
      .element(overlay.getByText("Lincoln Elementary · Grade 3"))
      .toBeVisible();

    await overlay.getByRole("button", { name: "Book evaluation" }).click();
    expect(overlays.openNewBooking).toHaveBeenCalledWith({
      kind: "evaluation",
      childId: "c-dia",
    });
    await expect.element(overlay).not.toBeInTheDocument();
  });

  it("says a Child with no home can only be booked in office", async () => {
    handlers.sortOut = ok(toPage([]));
    handlers.needsTutor = ok(toPage([]));
    await renderHome("admin");

    await card("Bookings").getByRole("button", { name: /Eve Newer/ }).click();
    const overlay = page.getByRole("dialog", { name: /Eve Newer/ });
    await expect.element(overlay.getByText("New today")).toBeVisible();
    await expect.element(overlay.getByText("No home yet: In office only")).toBeVisible();
  });

  it("links chat rows to the chat, with the reason and the Takeover window", async () => {
    await renderHome("admin");

    const row = card("Chats").getByRole("link", { name: /Diana Souza/ });
    await expect.element(row).toHaveAttribute("href", "/chats/ch-1");
    await expect.element(row.getByText("Wants to book")).toBeVisible();
    await expect.element(row.getByText("“Message from Diana Souza”")).toBeVisible();
    await expect.element(row.getByText(/Takeover closes in/)).toBeVisible();
  });

  it("links Time off rows to the request, naming non-Tutors and clashes", async () => {
    await renderHome("admin");

    const timeOff = card("Time off");
    const ana = timeOff.getByRole("link", { name: /Ana Souza/ });
    await expect.element(ana).toHaveAttribute("href", "/time-off/t-1");
    await expect.element(ana.getByText("2 Bookings in these dates")).toBeVisible();
    await expect.element(ana.getByText("Thu, Oct 22 – Fri, Oct 23")).toBeVisible();
    await expect
      .element(timeOff.getByRole("link", { name: /Bea Manager/ }).getByText("Manager", { exact: true }))
      .toBeVisible();
  });
  it("puts a Booking to change first even when it is past the first page", async () => {
    const unmarked = Array.from({ length: 100 }, (_, index) =>
      makeBooking(`b-old-${index}`, `Old ${index}`, {
        scheduled_date: "2026-09-01",
        sort_out_reasons: ["not_completed"],
      }),
    );
    handlers.sortOut = (search) =>
      Promise.resolve(
        search.get("page") === "2"
          ? { items: [CLASH], total: 101, page: 2, page_size: 100 }
          : { items: unmarked, total: 101, page: 1, page_size: 100 },
      );
    await renderHome("admin");

    const bookings = card("Bookings");
    await expect.element(bookings.getByText("Clara Clash")).toBeVisible();
    expect(bookings.getByRole("listitem").first().element().textContent).toContain(
      "Clara Clash",
    );
  });

  it("asks only for Children with no Evaluation booked yet", async () => {
    await renderHome("admin");

    await expect.element(card("Bookings").getByText("Clara Clash")).toBeVisible();
    const childLists = network.get.mock.calls
      .filter(([url]) => url === "/api/children")
      .map(([, config]) => (config as RequestConfig).params ?? {});
    expect(childLists).toContainEqual(expect.objectContaining({ evaluable: true }));
    expect(childLists.some((params) => "awaiting_evaluation" in params)).toBe(false);
  });
});

describe("card states", () => {
  it("shows a card's loading state while the rest of Home shows", async () => {
    handlers.chats = never;
    await renderHome("admin");

    await expect
      .element(card("Chats").getByRole("status", { name: "Loading Chats" }))
      .toBeVisible();
    await expect.element(card("Bookings").getByText("Clara Clash")).toBeVisible();
  });

  it("fails one card alone, with its own Try again", async () => {
    handlers.chats = fail;
    await renderHome("admin");

    const chats = card("Chats");
    await expect
      .element(chats.getByText("Couldn’t load chats. Check your connection and try again."))
      .toBeVisible();
    await expect.element(card("Bookings").getByText("Clara Clash")).toBeVisible();
    await expect.element(card("Time off").getByText("Ana Souza")).toBeVisible();
    // No partial count while a group failed.
    expect(page.getByText(/in To do,/).query()).toBeNull();

    handlers.chats = ok(CHATS);
    await chats.getByRole("button", { name: "Try again" }).click();
    await expect.element(chats.getByText("Diana Souza", { exact: true })).toBeVisible();
  });

  it("fails the Bookings card when any of its three lists fails", async () => {
    handlers.awaiting = fail;
    await renderHome("admin");

    await expect
      .element(card("Bookings").getByText(/Couldn’t load bookings/))
      .toBeVisible();
  });

  it("says All clear with each card's hint when there is nothing to do", async () => {
    handlers.chats = ok(toPage([]));
    handlers.sortOut = ok(toPage([]));
    handlers.needsTutor = ok(toPage([]));
    handlers.awaiting = ok(toPage([]));
    handlers.timeOff = ok(toPage([]));
    await renderHome("admin");

    await expect
      .element(card("Chats").getByText("No chat needs attention. The bot has it."))
      .toBeVisible();
    await expect
      .element(
        card("Bookings").getByText(
          "Every Booking is marked, and every Child has an Evaluation booked and an Assigned Tutor.",
        ),
      )
      .toBeVisible();
    await expect
      .element(card("Time off").getByText("No time-off requests to review."))
      .toBeVisible();
    await expect
      .element(page.getByText("Nothing in To do, 3 bookings today."))
      .toBeVisible();
  });

  it("gives Managers their own Bookings hint", async () => {
    handlers.sortOut = ok(toPage([]));
    handlers.needsTutor = ok(toPage([]));
    handlers.awaiting = ok(toPage([]));
    await renderHome("manager");

    await expect
      .element(
        card("Bookings").getByText(
          "Every Child has an Evaluation booked and an Assigned Tutor.",
        ),
      )
      .toBeVisible();
  });
});

describe("Today", () => {
  it("hides cancelled Bookings, puts the next first and the past last, dimmed", async () => {
    await renderHome("admin");

    const table = page.getByRole("table", { name: "Today’s bookings" });
    await expect.element(table.getByText("Nina Now")).toBeVisible();
    expect(table.getByText("Carl Cancelled").query()).toBeNull();
    const rows = table.getByRole("row").all().slice(1);
    expect(rows.map((row) => row.element().textContent)).toEqual([
      expect.stringContaining("Nina Now"),
      expect.stringContaining("Lia Later"),
      expect.stringContaining("Paul Past"),
    ]);
    await expect.element(table.getByText("Happening now")).toBeVisible();
    expect(rows[2].element().className).toContain("--tl-muted");
    expect(rows[0].element().className).not.toContain("--tl-muted");
  });

  it("opens Booking details from a row", async () => {
    await renderHome("admin");

    await page.getByRole("button", { name: "Open Lia Later at 3:30 PM" }).click();
    expect(overlays.openBooking).toHaveBeenCalledWith("b-later");
  });

  it("sends Open Bookings to the Bookings page", async () => {
    await renderHome("admin");

    await page.getByRole("button", { name: "Open Bookings" }).click();
    await expect.element(location()).toHaveTextContent("/bookings");
  });

  it("dims a Manager's past sessions and opens details", async () => {
    await renderHome("manager");

    await expect.element(page.getByRole("button", { name: /Nina Now/ })).toBeVisible();
    expect(page.getByText("Carl Cancelled").query()).toBeNull();
    await expect
      .element(page.getByRole("button", { name: /Paul Past/ }).getByText("Done"))
      .toBeVisible();
    await page.getByRole("button", { name: /Lia Later/ }).click();
    expect(overlays.openBooking).toHaveBeenCalledWith("b-later");
  });

  it("shows its own inline error with Try again", async () => {
    handlers.today = fail;
    await renderHome("admin");

    await expect
      .element(
        page.getByText(
          "Couldn’t load today’s bookings. Check your connection and try again.",
        ),
      )
      .toBeVisible();
    await expect.element(card("Chats").getByText("Diana Souza", { exact: true })).toBeVisible();
  });

  it.each([
    ["admin", "No bookings today"],
    ["manager", "No sessions today"],
  ] as const)("tells a %s when nothing is booked", async (role, title) => {
    handlers.today = ok(toPage([]));
    await renderHome(role);

    await expect.element(page.getByRole("heading", { name: title })).toBeVisible();
  });
});

describe("freshness", () => {
  it("updates the cue after a refetch", async () => {
    await renderHome("admin");

    await expect.element(page.getByText("Updated 1:10 PM")).toBeVisible();
    vi.setSystemTime(ONE_MINUTE_LATER);
    refocusWindow();
    await expect.element(page.getByText("Updated 1:11 PM")).toBeVisible();
  });

  it("keeps the data when a refetch fails, with a stale cue and Retry", async () => {
    await renderHome("admin");

    await expect.element(page.getByText("Updated 1:10 PM")).toBeVisible();
    handlers.chats = fail;
    vi.setSystemTime(ONE_MINUTE_LATER);
    refocusWindow();

    const cue = page.getByRole("status").filter({ hasText: "Couldn’t refresh" });
    await expect.element(cue).toHaveTextContent("Couldn’t refresh. Showing 1:10 PM.");
    await expect.element(card("Chats").getByText("Diana Souza", { exact: true })).toBeVisible();

    handlers.chats = ok(CHATS);
    await cue.getByRole("button", { name: "Retry" }).click();
    await expect.element(page.getByText("Updated 1:11 PM")).toBeVisible();
  });
});
