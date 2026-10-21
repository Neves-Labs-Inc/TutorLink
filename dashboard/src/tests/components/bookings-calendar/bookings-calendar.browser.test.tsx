import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import KitRoot from "@/components/kit/kit-root";
import { formatDay, getTodayKey } from "@/components/kit/format";
import BookingsCalendar from "@/components/bookings-calendar/bookings-calendar";
import type { BookingListFilters } from "@/lib/bookings/booking-filters";
import type { BookingSummary } from "@/lib/queries/bookings";
import { addDays, addWeeks, getWeekStart } from "@/lib/week";
import {
  createTestQueryClient,
  renderWithProviders,
} from "@/test/render-with-providers";

const network = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get },
}));

// Real "today", so the today column and the now line can be checked.
const TODAY = getTodayKey();
const WEEK = getWeekStart(TODAY);
const NEXT_WEEK = addWeeks(WEEK, 1);
const PREVIOUS_WEEK = addWeeks(WEEK, -1);
const TUESDAY = addDays(WEEK, 1);
const WEDNESDAY = addDays(WEEK, 2);

const NO_FILTERS: BookingListFilters = {
  q: "",
  kinds: [],
  statuses: [],
  userIds: [],
  childIds: [],
};

const ANA = { id: "user-ana", name: "Ana Souza", role: "tutor" as const };
const BRUNO = { id: "user-bruno", name: "Bruno Lima", role: "tutor" as const };
const RITA = { id: "user-rita", name: "Rita Admin", role: "admin" as const };

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
    home: { id: "home-1", label: "Main home", address: "1 Palm St", directions: null },
    guardians: [],
    sort_out_reasons: [],
    clash_acknowledged_by: null,
    clash_acknowledged_at: null,
    ...overrides,
  };
}

const TUTORING = makeBooking();
const EVALUATION = makeBooking({
  id: "booking-2",
  child: { id: "child-2", name: "Lucas Lima", notes: null },
  staff: RITA,
  kind: "evaluation",
  location: "in_office",
  subject: null,
  subject_level: null,
  home: null,
  start_time: "10:00:00",
  end_time: "11:00:00",
});
const CLASHING = makeBooking({
  id: "booking-3",
  child: { id: "child-3", name: "Mia Costa", notes: null },
  scheduled_date: WEDNESDAY,
  start_time: "09:00:00",
  end_time: "10:00:00",
  sort_out_reasons: ["time_off_clash"],
});
const CANCELLED = makeBooking({
  id: "booking-4",
  child: { id: "child-4", name: "Noah Reis", notes: null },
  staff: BRUNO,
  scheduled_date: WEDNESDAY,
  start_time: "13:00:00",
  end_time: "14:00:00",
  status: "cancelled",
});

const ANA_OFF = {
  id: "off-1",
  staff: ANA,
  start_date: WEDNESDAY,
  end_date: WEDNESDAY,
  start_time: null,
  end_time: null,
  status: "approved",
};

type Fixtures = {
  bookingsByWeek?: Record<string, BookingSummary[]>;
  timeOff?: (typeof ANA_OFF)[];
  isFailing?: boolean;
};

function page1<T>(items: T[]) {
  return { data: { items, total: items.length, page: 1, page_size: 100 } };
}

function serve({ bookingsByWeek = {}, timeOff = [], isFailing = false }: Fixtures) {
  network.get.mockImplementation(async (url: string) => {
    if (url.startsWith("/api/bookings")) {
      if (isFailing) throw new Error("network down");
      const from = new URLSearchParams(url.split("?")[1]).get("from") ?? "";
      return page1(bookingsByWeek[from] ?? []);
    }
    if (url.startsWith("/api/exceptions")) return page1(timeOff);
    if (url === "/api/staff") {
      return page1([
        { ...ANA, tutor_id: "tutor-ana" },
        { ...BRUNO, tutor_id: "tutor-bruno" },
        { ...RITA, tutor_id: null },
      ]);
    }
    if (url === "/api/tutors/tutor-ana/availability") {
      return page1([
        {
          id: "slot-1",
          tutor_id: "tutor-ana",
          day_of_week: 1,
          start_time: "14:00:00",
          end_time: "18:00:00",
          is_active: true,
          mode: "anywhere",
        },
      ]);
    }
    if (url === "/api/tutors/tutor-bruno/availability") {
      return page1([
        {
          id: "slot-2",
          tutor_id: "tutor-bruno",
          day_of_week: 2,
          start_time: "09:00:00",
          end_time: "12:00:00",
          is_active: true,
          mode: "anywhere",
        },
      ]);
    }
    throw new Error(`Unexpected GET ${url}`);
  });
}

function bookingWeeksRequested(): string[] {
  return network.get.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith("/api/bookings"))
    .map((url) => new URLSearchParams(url.split("?")[1]).get("from") ?? "");
}

type RenderOptions = {
  scale?: "week" | "day";
  weekStart?: string;
  day?: string;
  filters?: BookingListFilters;
};

function makeCallbacks() {
  return { onDayChange: vi.fn(), onOpenBooking: vi.fn(), onNewBooking: vi.fn() };
}

function renderCalendar(
  options: RenderOptions = {},
  callbacks = makeCallbacks(),
) {
  const {
    scale = "week",
    weekStart = WEEK,
    day = TUESDAY,
    filters = NO_FILTERS,
  } = options;
  const ui = (props: RenderOptions) => (
    <KitRoot theme="light">
      <div className="p-4">
        <BookingsCalendar
          scale={props.scale ?? scale}
          weekStart={props.weekStart ?? weekStart}
          day={props.day ?? day}
          filters={props.filters ?? filters}
          {...callbacks}
        />
      </div>
    </KitRoot>
  );
  const queryClient = createTestQueryClient();
  return {
    ui,
    callbacks,
    queryClient,
    screen: renderWithProviders(ui({}), queryClient),
  };
}

beforeEach(async () => {
  await page.viewport(1280, 900);
  network.get.mockReset();
});

describe("week loading", () => {
  it("requests the shown week first, then the weeks either side", async () => {
    serve({ bookingsByWeek: { [WEEK]: [TUTORING] } });
    await renderCalendar().screen;

    await expect
      .element(page.getByRole("button", { name: /Emma Souza/ }))
      .toBeVisible();
    await vi.waitFor(() => expect(bookingWeeksRequested()).toHaveLength(3));
    expect(bookingWeeksRequested()[0]).toBe(WEEK);
    expect(bookingWeeksRequested().slice(1).sort()).toEqual(
      [PREVIOUS_WEEK, NEXT_WEEK].sort(),
    );
  });

  it("shows the next week at once from the cache", async () => {
    const zoe = makeBooking({
      id: "booking-next",
      scheduled_date: addDays(NEXT_WEEK, 1),
      child: { id: "child-9", name: "Zoe Next", notes: null },
    });
    serve({ bookingsByWeek: { [WEEK]: [TUTORING], [NEXT_WEEK]: [zoe] } });
    const { ui, screen, queryClient } = renderCalendar();
    const rendered = await screen;
    await vi.waitFor(() => {
      expect(bookingWeeksRequested()).toHaveLength(3);
      expect(queryClient.isFetching()).toBe(0);
    });

    rendered.rerender(ui({ weekStart: NEXT_WEEK, day: addDays(NEXT_WEEK, 1) }));

    expect(
      page.getByRole("status", { name: "Loading bookings" }).elements(),
    ).toHaveLength(0);
    await expect
      .element(page.getByRole("button", { name: /Zoe Next/ }))
      .toBeVisible();
  });
});

describe("week view", () => {
  const WEEK_BOOKINGS = [TUTORING, EVALUATION, CLASHING, CANCELLED];

  it("labels each block with time, Child, Staff, kind and status", async () => {
    serve({ bookingsByWeek: { [WEEK]: WEEK_BOOKINGS } });
    await renderCalendar().screen;

    await expect
      .element(
        page.getByRole("button", {
          name: "3:30 PM, Emma Souza, Math with Ana Souza, Confirmed",
        }),
      )
      .toBeVisible();
    await expect
      .element(
        page.getByRole("button", {
          name: "10:00 AM, Lucas Lima, Evaluation with Rita Admin, Confirmed",
        }),
      )
      .toBeVisible();
    await expect
      .element(
        page.getByRole("button", {
          name: "9:00 AM, Mia Costa, Math with Ana Souza, Confirmed, needs attention: Staff is off",
        }),
      )
      .toBeVisible();
    await expect
      .element(
        page.getByRole("button", {
          name: "1:00 PM, Noah Reis, Math with Bruno Lima, Cancelled",
        }),
      )
      .toBeVisible();
  });

  it("colours Tutoring primary, Evaluation pink and mutes Cancelled", async () => {
    serve({ bookingsByWeek: { [WEEK]: WEEK_BOOKINGS } });
    await renderCalendar().screen;

    const tutoring = page.getByRole("button", { name: /Emma Souza/ });
    await expect.element(tutoring).toHaveClass(/bg-\(--tl-tint-strong\)/);
    await expect
      .element(page.getByRole("button", { name: /Lucas Lima/ }))
      .toHaveClass(/bg-\(--tl-pink-tint\)/);
    await expect
      .element(page.getByRole("button", { name: /Mia Costa/ }))
      .toHaveClass(/border-\(--tl-warning\)/);
    const cancelled = page.getByRole("button", { name: /Noah Reis/ });
    await expect.element(cancelled).toHaveClass(/bg-\(--tl-surface-sunk\)/);
    await expect.element(cancelled.getByText("Noah Reis")).toHaveClass(/line-through/);
  });

  it("marks today's column", async () => {
    serve({});
    await renderCalendar().screen;

    await expect.element(page.getByText("(today)")).toBeInTheDocument();
    expect(page.getByText("(today)").elements()).toHaveLength(1);
  });

  it("shows approved Time off as a pill on the days it covers", async () => {
    serve({ timeOff: [ANA_OFF] });
    await renderCalendar().screen;

    const pill = page.getByTitle("Ana Souza is off");
    await expect.element(pill).toBeVisible();
    expect(pill.elements()).toHaveLength(1);
    await expect.element(pill).toHaveTextContent("Ana off");
  });

  it("asks only for approved Time off in the shown week", async () => {
    serve({});
    await renderCalendar().screen;

    await vi.waitFor(() =>
      expect(network.get).toHaveBeenCalledWith("/api/exceptions", {
        params: {
          status: "approved",
          from: WEEK,
          to: addDays(WEEK, 6),
          page_size: 100,
        },
      }),
    );
  });

  it("opens a Booking when its block is tapped", async () => {
    serve({ bookingsByWeek: { [WEEK]: [TUTORING] } });
    const { callbacks, screen } = renderCalendar();
    await screen;

    await page.getByRole("button", { name: /Emma Souza/ }).click();

    expect(callbacks.onOpenBooking).toHaveBeenCalledWith("booking-1");
  });

  it("starts a New booking at the tapped empty hour", async () => {
    serve({});
    const { callbacks, screen } = renderCalendar();
    await screen;
    const label = `New booking ${formatDay(WEDNESDAY, { weekday: "short", month: "short", day: "numeric" })} at 10:00 AM`;

    await page.getByRole("button", { name: label }).click();

    expect(callbacks.onNewBooking).toHaveBeenCalledWith({
      date: WEDNESDAY,
      startTime: "10:00:00",
    });
  });

  it("sends the page's filters with the week's request", async () => {
    serve({});
    await renderCalendar({
      filters: {
        q: " emma ",
        kinds: ["evaluation"],
        statuses: ["confirmed", "pending"],
        userIds: [ANA.id],
        childIds: [],
      },
    }).screen;

    await vi.waitFor(() => expect(bookingWeeksRequested()).toContain(WEEK));
    const url = String(network.get.mock.calls[0][0]);
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.getAll("kind")).toEqual(["evaluation"]);
    expect(params.getAll("status")).toEqual(["confirmed", "pending"]);
    expect(params.getAll("user_id")).toEqual([ANA.id]);
    expect(params.get("q")).toBe("emma");
    expect(params.get("to")).toBe(addDays(WEEK, 6));
    expect(params.get("page_size")).toBe("100");
  });

  it("asks for every status when no Status filter is on", async () => {
    serve({});
    await renderCalendar().screen;

    await vi.waitFor(() => expect(bookingWeeksRequested()).toContain(WEEK));
    const url = String(network.get.mock.calls[0][0]);
    expect(new URLSearchParams(url.split("?")[1]).getAll("status")).toEqual([]);
  });
});

describe("Day by Staff", () => {
  // Tuesday: Ana has a Booking and Availability, Rita (Admin) has an
  // Evaluation, Bruno is free only on Wednesdays.
  it("gives a column to each Staff member with something that day", async () => {
    serve({ bookingsByWeek: { [WEEK]: [TUTORING, EVALUATION] } });
    await renderCalendar({ scale: "day", day: TUESDAY }).screen;

    await expect.element(page.getByText("Ana", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Rita", { exact: true })).toBeVisible();
    expect(page.getByText("Bruno", { exact: true }).elements()).toHaveLength(0);
    await expect
      .element(page.getByText("Available (from their Availability)"))
      .toBeVisible();
  });

  it("notes Time off in the column header and shades no Availability", async () => {
    const anaOffTuesday = { ...ANA_OFF, start_date: TUESDAY, end_date: TUESDAY };
    serve({ bookingsByWeek: { [WEEK]: [TUTORING] }, timeOff: [anaOffTuesday] });
    await renderCalendar({ scale: "day", day: TUESDAY }).screen;

    await expect.element(page.getByTitle("Ana Souza is off")).toHaveTextContent("Time off");
  });

  it("shades Availability for that weekday", async () => {
    serve({});
    await renderCalendar({ scale: "day", day: WEDNESDAY }).screen;

    await expect.element(page.getByText("Bruno", { exact: true })).toBeVisible();
    await vi.waitFor(() =>
      expect(document.querySelectorAll("div.bg-\\(--tl-green-tint\\)[aria-hidden]")).toHaveLength(1),
    );
  });

  it("keeps an archived Staff member's column, marked Archived", async () => {
    const archived = makeBooking({
      id: "booking-old",
      staff: { id: "user-gone", name: "Gil Former", role: "tutor" },
      sort_out_reasons: ["archived_staff"],
    });
    serve({ bookingsByWeek: { [WEEK]: [archived] } });
    await renderCalendar({ scale: "day", day: TUESDAY }).screen;

    await expect.element(page.getByText("Gil", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Archived")).toBeVisible();
  });

  it("keeps a column for the filtered Staff member on a day they have nothing", async () => {
    serve({});
    const { callbacks, screen } = renderCalendar({
      scale: "day",
      day: addDays(WEEK, 6),
      filters: { ...NO_FILTERS, userIds: [BRUNO.id] },
    });
    await screen;
    const day = formatDay(addDays(WEEK, 6), { weekday: "short", month: "short", day: "numeric" });

    await page
      .getByRole("button", { name: `New booking with Bruno Lima, ${day} at 9:00 AM` })
      .click();

    expect(callbacks.onNewBooking).toHaveBeenCalledWith({
      date: addDays(WEEK, 6),
      startTime: "09:00:00",
      userId: BRUNO.id,
    });
  });

  it("says so when nobody is booked or available that day", async () => {
    serve({});
    await renderCalendar({ scale: "day", day: addDays(WEEK, 6) }).screen;
    const weekday = formatDay(addDays(WEEK, 6), { weekday: "long" });

    await expect
      .element(page.getByText(`Nobody is booked or available on ${weekday}.`))
      .toBeVisible();
  });

  it("respects the Staff filter", async () => {
    serve({ bookingsByWeek: { [WEEK]: [TUTORING] } });
    await renderCalendar({
      scale: "day",
      day: WEDNESDAY,
      filters: { ...NO_FILTERS, userIds: [ANA.id] },
    }).screen;

    await expect
      .element(page.getByText("Available (from their Availability)"))
      .toBeVisible();
    expect(page.getByText("Bruno", { exact: true }).elements()).toHaveLength(0);
  });

  it("starts a New booking with that Staff member at the tapped hour", async () => {
    serve({ bookingsByWeek: { [WEEK]: [TUTORING] } });
    const { callbacks, screen } = renderCalendar({ scale: "day", day: TUESDAY });
    await screen;
    const day = formatDay(TUESDAY, { weekday: "short", month: "short", day: "numeric" });

    await page
      .getByRole("button", { name: `New booking with Ana Souza, ${day} at 9:00 AM` })
      .click();

    expect(callbacks.onNewBooking).toHaveBeenCalledWith({
      date: TUESDAY,
      startTime: "09:00:00",
      userId: ANA.id,
    });
  });

  it("changes day from the strip", async () => {
    serve({});
    const { callbacks, screen } = renderCalendar({ scale: "day", day: TUESDAY });
    await screen;

    await page.getByRole("group", { name: "Day" }).getByRole("button").nth(2).click();

    expect(callbacks.onDayChange).toHaveBeenCalledWith(WEDNESDAY);
  });
});

describe("phone", () => {
  beforeEach(async () => {
    await page.viewport(375, 800);
  });

  it("shows the strip and day agenda instead of the grid", async () => {
    serve({ bookingsByWeek: { [WEEK]: [TUTORING, EVALUATION] } });
    await renderCalendar({ day: TUESDAY }).screen;

    await expect.element(page.getByRole("group", { name: "Day" })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: /Emma Souza/ }))
      .toHaveTextContent("Math · Ana Souza");
    expect(document.querySelectorAll("[data-booking-block]")).toHaveLength(0);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
  });

  it("lists the day's Bookings by start time with their reason badges", async () => {
    const late = makeBooking({ id: "late", start_time: "17:00:00", end_time: "18:00:00", child: { id: "c5", name: "Late Kid", notes: null }, sort_out_reasons: ["not_completed"] });
    serve({ bookingsByWeek: { [WEEK]: [late, TUTORING, EVALUATION] } });
    await renderCalendar({ day: TUESDAY }).screen;

    await expect.element(page.getByText("Late Kid")).toBeVisible();
    const titles = page
      .getByRole("listitem")
      .elements()
      .map((item) => item.querySelector(".kit-display")?.textContent);
    expect(titles).toEqual(["Lucas Lima", "Emma Souza", "Late Kid"]);
    await expect
      .element(page.getByRole("button", { name: /Late Kid/ }))
      .toHaveTextContent("Not marked");
  });

  it("mutes and strikes a cancelled row and names its status", async () => {
    serve({ bookingsByWeek: { [WEEK]: [CANCELLED] } });
    await renderCalendar({ day: WEDNESDAY }).screen;

    const row = page.getByRole("button", { name: /Noah Reis/ });
    await expect.element(row).toHaveTextContent("Cancelled");
    await expect.element(row.getByText("Noah Reis")).toHaveClass(/line-through/);
  });

  it("names the day's Bookings in the strip", async () => {
    serve({ bookingsByWeek: { [WEEK]: [TUTORING, EVALUATION] } });
    await renderCalendar({ day: TUESDAY }).screen;
    const tuesday = formatDay(TUESDAY, { weekday: "long", month: "long", day: "numeric" });

    await expect
      .element(page.getByRole("button", { name: `${tuesday}, 2 bookings` }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("opens a Booking from its row and changes day from the strip", async () => {
    serve({ bookingsByWeek: { [WEEK]: [TUTORING] } });
    const { callbacks, screen } = renderCalendar({ day: TUESDAY });
    await screen;

    await page.getByRole("button", { name: /Emma Souza/ }).click();
    await page.getByRole("group", { name: "Day" }).getByRole("button").nth(2).click();

    expect(callbacks.onOpenBooking).toHaveBeenCalledWith("booking-1");
    expect(callbacks.onDayChange).toHaveBeenCalledWith(WEDNESDAY);
  });

  it("shows Time off for the day", async () => {
    serve({ timeOff: [ANA_OFF] });
    await renderCalendar({ day: WEDNESDAY }).screen;

    await expect
      .element(page.getByText("Ana Souza is off (approved Time off)"))
      .toBeVisible();
  });

  it("says when nothing is booked that day", async () => {
    serve({});
    await renderCalendar({ day: WEDNESDAY }).screen;
    const weekday = formatDay(WEDNESDAY, { weekday: "long" });

    await expect
      .element(page.getByText(`Nothing booked on ${weekday}.`))
      .toBeVisible();
  });
});

describe("states", () => {
  it("shows a week skeleton while the week loads", async () => {
    network.get.mockReturnValue(new Promise(() => {}));
    await renderCalendar().screen;

    await expect
      .element(page.getByRole("status", { name: "Loading bookings" }))
      .toBeVisible();
  });

  it("shows the error with Try again, which reloads the week", async () => {
    serve({ isFailing: true });
    await renderCalendar().screen;

    await expect.element(page.getByRole("alert")).toHaveTextContent("Couldn’t load bookings");
    serve({ bookingsByWeek: { [WEEK]: [TUTORING] } });
    await page.getByRole("button", { name: "Try again" }).click();

    await expect
      .element(page.getByRole("button", { name: /Emma Souza/ }))
      .toBeVisible();
  });

  it("keeps the error on screen, saying it is trying again, while Try again runs", async () => {
    serve({ isFailing: true });
    await renderCalendar().screen;
    await expect.element(page.getByRole("alert")).toBeVisible();
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    serve({ bookingsByWeek: { [WEEK]: [TUTORING] } });
    const serveWeek = network.get.getMockImplementation();
    network.get.mockImplementation(async (url: string, config?: unknown) => {
      if (url.startsWith("/api/bookings")) await held;
      return serveWeek?.(url, config);
    });

    await page.getByRole("button", { name: "Try again" }).click();

    await expect.element(page.getByRole("alert")).toHaveTextContent("Trying again…");
    expect(
      page.getByRole("status", { name: "Loading bookings" }).elements(),
    ).toHaveLength(0);
    release();
    await expect
      .element(page.getByRole("button", { name: /Emma Souza/ }))
      .toBeVisible();
  });

  it("keeps the grid with tappable hours on an empty week", async () => {
    serve({});
    const { callbacks, screen } = renderCalendar();
    await screen;

    await expect
      .element(page.getByRole("status").filter({ hasText: "No bookings this week." }))
      .toBeVisible();
    const label = `New booking ${formatDay(WEEK, { weekday: "short", month: "short", day: "numeric" })} at 2:00 PM`;
    await page.getByRole("button", { name: label }).click();
    expect(callbacks.onNewBooking).toHaveBeenCalledWith({ date: WEEK, startTime: "14:00:00" });
  });
});
