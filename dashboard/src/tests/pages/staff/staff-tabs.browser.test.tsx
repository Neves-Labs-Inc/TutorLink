import type { ReactNode } from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { getTodayKey } from "@/components/kit/format";
import type { BookingSummary } from "@/lib/queries/bookings";
import type { ExceptionRead } from "@/lib/queries/time-off";
import {
  ANA,
  getPath,
  never,
  renderApp,
  respond,
  RITA,
} from "@/tests/pages/staff/staff-harness";

const SIZES = [
  ["1280", { width: 1280, height: 800 }],
  ["390", { width: 390, height: 800 }],
] as const;
const MIN_ROW_HEIGHT = 72;
// The kit overlay is a pushed page below this width.
const PHONE_PAGE_WIDTH = 672;
const PAGE_SIZE = 25;
const BOOKING_LIMIT = 10;

const network = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get, put: network.put, post: network.post },
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

const START_URL = window.location.href;

function makeTimeOff(overrides: Partial<ExceptionRead>): ExceptionRead {
  return {
    id: "to-1",
    staff: { id: ANA.id, name: ANA.name, role: "tutor" },
    start_date: "2031-10-20",
    end_date: "2031-10-22",
    start_time: null,
    end_time: null,
    reason: "Family trip",
    status: "approved",
    created_at: "2031-10-01T14:00:00Z",
    decided_by: { id: RITA.id, name: RITA.name },
    decided_at: "2031-10-02T14:00:00Z",
    cancelled_by: null,
    cancelled_at: null,
    entered_by: null,
    clashing_bookings: [],
    clashing_bookings_count: 0,
    ...overrides,
  };
}

const COMING_LATE = makeTimeOff({
  id: "to-late",
  start_date: "2031-12-01",
  end_date: "2031-12-01",
  start_time: "13:00:00",
  end_time: "17:00:00",
  reason: null,
  status: "pending",
});
const COMING_SOON = makeTimeOff({ id: "to-soon" });
const GONE_OLD = makeTimeOff({
  id: "to-old",
  start_date: "2020-01-06",
  end_date: "2020-01-06",
  reason: "Old trip",
});
const GONE_NEW = makeTimeOff({
  id: "to-new",
  start_date: "2021-03-08",
  end_date: "2021-03-08",
  reason: "Newer trip",
});

function makeBooking(index: number, overrides: Partial<BookingSummary> = {}): BookingSummary {
  const day = String(index + 1).padStart(2, "0");
  return {
    id: `b-${index}`,
    child: { id: "c-1", name: "Emma Lee", notes: null },
    staff: { id: ANA.id, name: ANA.name, role: "tutor" },
    kind: "regular",
    location: "home",
    subject: { id: "s-maths", name: "Maths" },
    scheduled_date: `2031-11-${day}`,
    start_time: "15:30:00",
    end_time: "16:30:00",
    status: "confirmed",
    notes: null,
    updated_at: "2031-10-01T14:00:00Z",
    office_address: null,
    subject_level: null,
    home: { id: "h-1", label: "Garcia home", address: "1 Main St", directions: null },
    guardians: [],
    sort_out_reasons: [],
    clash_acknowledged_by: null,
    clash_acknowledged_at: null,
    ...overrides,
  };
}

type Feeds = {
  timeOff?: (params: { page: number }) => Promise<unknown>;
  bookings?: () => Promise<unknown>;
  availability?: unknown[];
};

function pageOf(items: unknown[], total = items.length, current = 1): unknown {
  return { items, total, page: current, page_size: PAGE_SIZE };
}

function serve({
  timeOff = async () => pageOf([COMING_SOON, COMING_LATE, GONE_OLD, GONE_NEW]),
  bookings = async () => pageOf([makeBooking(0)]),
  availability = [],
}: Feeds = {}): void {
  respond(network.get);
  const base = network.get.getMockImplementation();
  network.get.mockImplementation(
    async (url: string, config?: { params?: { page: number } }) => {
      let data: unknown;
      if (url.endsWith("/exceptions")) {
        data = await timeOff({ page: config?.params?.page ?? 1 });
      } else if (url.startsWith("/api/exceptions/")) {
        const id = url.slice("/api/exceptions/".length);
        data = [COMING_SOON, COMING_LATE, GONE_OLD, GONE_NEW].find((row) => row.id === id);
      } else if (url.startsWith("/api/bookings/")) {
        // Booking details stay loading; these tests only follow the link.
        data = await new Promise(() => {});
      } else if (url.startsWith("/api/bookings")) {
        data = await bookings();
      } else if (url.endsWith("/availability")) {
        data = pageOf(availability);
      } else {
        return base?.(url, config);
      }
      return { data };
    },
  );
}

const panel = () => page.getByRole("dialog", { name: /^Staff: / });
// The Availability editor's own Edit (the header has the account's Edit too).
const availabilityEdit = () =>
  panel().element().querySelector<HTMLElement>("[data-edit-button]");
const stacked = () => page.getByRole("dialog", { name: /^Time off for / });
const rowButtons = () =>
  panel().getByRole("button").elements().filter((el) => el.closest("li") && !el.closest("nav"));

function expectNoHorizontalScroll(): void {
  const root = document.documentElement;
  expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
  const el = panel().element();
  expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth);
}

beforeEach(() => {
  network.get.mockReset();
  network.put.mockReset();
  network.post.mockReset();
  serve();
});

afterAll(() => {
  window.history.replaceState(null, "", START_URL);
});

describe.each(SIZES)("Staff tabs at %s", (_label, size) => {
  beforeEach(async () => {
    await page.viewport(size.width, size.height);
  });

  describe("Availability", () => {
    it("is editable for an Admin and saves with the third-person toast", async () => {
      const slot = {
        id: "s-1",
        tutor_id: "t-ana",
        day_of_week: 0,
        start_time: "15:00:00",
        end_time: "18:00:00",
        is_active: true,
        mode: "traveler",
      };
      serve({ availability: [slot] });
      network.put.mockResolvedValue({ data: pageOf([{ ...slot, end_time: "19:00:00" }]) });
      await renderApp("/staff/u-ana?tab=availability");
      await expect.element(panel().getByText("3:00 PM – 6:00 PM")).toBeVisible();
      await userEvent.click(availabilityEdit() as HTMLElement);
      await page.getByLabelText("Monday range 1 ends").fill("19:00");
      await page.getByRole("button", { name: "Save" }).click();
      await expect.element(page.getByText("Ana’s Availability saved.")).toBeVisible();
      expect(network.put).toHaveBeenCalledOnce();
      expectNoHorizontalScroll();
    });

    it.each([
      ["a Manager viewing", "/staff/u-ana?tab=availability", "manager" as const],
      ["an Admin viewing archived Staff", "/staff/u-zoe?tab=availability", "admin" as const],
    ])("is read-only for %s", async (_who, path, role) => {
      await renderApp(path, role);
      await expect
        .element(panel().getByText("No time ranges yet"))
        .toBeVisible();
      expect(availabilityEdit()).toBeNull();
    });

    it("is editable on a Manager target", async () => {
      await renderApp("/staff/u-mo?tab=availability");
      await expect.poll(availabilityEdit).not.toBeNull();
    });

    it("is absent on an Admin target", async () => {
      await renderApp("/staff/u-dan");
      await expect.element(panel().getByText("Email")).toBeVisible();
      expect(
        panel()
          .getByRole("navigation", { name: "Staff details sections" })
          .getByRole("button", { name: "Availability" })
          .elements(),
      ).toHaveLength(0);
    });
  });

  describe("Time off", () => {
    it("lists Upcoming soonest first, then History most recent first", async () => {
      await renderApp("/staff/u-ana?tab=time-off");
      await expect
        .element(panel().getByRole("heading", { name: "Upcoming" }))
        .toBeVisible();
      const rows = rowButtons().filter((el) => /Oct|Dec|Jan|Mar/.test(el.textContent ?? ""));
      expect(rows.map((el) => el.textContent)).toEqual([
        expect.stringContaining("Oct 20"),
        expect.stringContaining("Dec 1"),
        expect.stringContaining("Mar 8"),
        expect.stringContaining("Jan 6"),
      ]);
      await expect.element(panel().getByRole("heading", { name: "History" })).toBeVisible();
      await expect.element(panel().getByText("No reason given")).toBeVisible();
      for (const row of rows) {
        expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(MIN_ROW_HEIGHT);
      }
      expectNoHorizontalScroll();
    });

    it("hides a section that has nothing", async () => {
      serve({ timeOff: async () => pageOf([GONE_OLD]) });
      await renderApp("/staff/u-ana?tab=time-off");
      await expect.element(panel().getByRole("heading", { name: "History" })).toBeVisible();
      expect(panel().getByRole("heading", { name: "Upcoming" }).elements()).toHaveLength(0);
    });

    it("opens a row's details stacked, and Back returns to the tab and the row", async () => {
      await renderApp("/staff/u-ana?tab=time-off");
      const row = panel().getByRole("button", { name: /Oct 20/ });
      await row.click();
      await expect.element(stacked()).toBeVisible();
      if (size.width < PHONE_PAGE_WIDTH) {
        const back = stacked().getByRole("button", { name: "Ana’s details" });
        await expect.element(back).toBeVisible();
        await back.click();
      } else {
        await userEvent.keyboard("{Escape}");
      }
      await expect.element(stacked()).not.toBeInTheDocument();
      expect(getPath()).toBe("/staff/u-ana?tab=time-off");
      await expect.element(row).toHaveFocus();
    });

    it("offers Add time off to an Admin for live Staff, with the person preset", async () => {
      await renderApp("/staff/u-ana?tab=time-off");
      await panel().getByRole("button", { name: "Add time off" }).click();
      await expect
        .element(page.getByRole("dialog", { name: "Add time off for Ana" }))
        .toBeVisible();
    });

    it("opens the new item's details after adding", async () => {
      const created = makeTimeOff({ id: "to-soon" });
      network.post.mockResolvedValue({ data: created });
      await renderApp("/staff/u-ana?tab=time-off");
      await panel().getByRole("button", { name: "Add time off" }).click();
      await page.getByLabelText("First day").fill("2031-10-20");
      await page
        .getByRole("dialog", { name: "Add time off for Ana" })
        .getByRole("button", { name: "Add time off", exact: true })
        .click();
      await expect.element(stacked()).toBeVisible();
      expect(network.post).toHaveBeenCalledWith(
        `/api/users/${ANA.id}/exceptions`,
        expect.objectContaining({ start_date: "2031-10-20" }),
      );
    });

    it.each([
      ["a Manager", "/staff/u-ana?tab=time-off", "manager" as const],
      ["an Admin on archived Staff", "/staff/u-zoe?tab=time-off", "admin" as const],
    ])("has no Add time off for %s", async (_who, path, role) => {
      await renderApp(path, role);
      await expect.element(panel().getByRole("heading", { name: "Upcoming" })).toBeVisible();
      expect(panel().getByRole("button", { name: "Add time off" }).elements()).toHaveLength(0);
    });

    it("works on an Admin target", async () => {
      await renderApp("/staff/u-dan?tab=time-off");
      await expect.element(panel().getByRole("button", { name: "Add time off" })).toBeVisible();
    });

    it("pages 25 at a time with the Pager, keeping the page up meanwhile", async () => {
      const items = Array.from({ length: PAGE_SIZE }, (_, i) =>
        makeTimeOff({ id: `to-${i}`, start_date: "2031-10-20", end_date: "2031-10-20" }),
      );
      serve({
        timeOff: async ({ page: requested }) =>
          requested === 1 ? pageOf(items, PAGE_SIZE + 1) : pageOf([GONE_OLD], PAGE_SIZE + 1, 2),
      });
      await renderApp("/staff/u-ana?tab=time-off");
      const nav = panel().getByRole("navigation", { name: "Time off pages" });
      await expect.element(nav).toBeVisible();
      await nav.getByRole("button", { name: /next/i }).click();
      await expect.element(panel().getByText("Old trip")).toBeVisible();
      expect(network.get).toHaveBeenCalledWith(
        `/api/users/${ANA.id}/exceptions`,
        { params: { order: "desc", page: 2, page_size: PAGE_SIZE } },
      );
    });

    it("shows no Pager for a single page", async () => {
      await renderApp("/staff/u-ana?tab=time-off");
      await expect.element(panel().getByRole("heading", { name: "Upcoming" })).toBeVisible();
      expect(panel().getByRole("navigation", { name: "Time off pages" }).elements()).toHaveLength(0);
    });

    it("says there is none when empty, keeping Add for an Admin", async () => {
      serve({ timeOff: async () => pageOf([]) });
      await renderApp("/staff/u-ana?tab=time-off");
      await expect.element(panel().getByText("No time off")).toBeVisible();
      await expect.element(panel().getByRole("button", { name: "Add time off" })).toBeVisible();
    });

    it("shows a skeleton while loading", async () => {
      serve({ timeOff: never });
      await renderApp("/staff/u-ana?tab=time-off");
      await expect
        .element(panel().getByRole("status", { name: "Loading time off" }))
        .toBeVisible();
    });

    it("shows an error with Try again that recovers", async () => {
      let isFailing = true;
      serve({
        timeOff: async () => {
          if (isFailing) throw new Error("offline");
          return pageOf([COMING_SOON]);
        },
      });
      await renderApp("/staff/u-ana?tab=time-off");
      await expect
        .element(
          panel().getByText("Couldn’t load their time off. Check your connection and try again."),
        )
        .toBeVisible();
      isFailing = false;
      await panel().getByRole("button", { name: "Try again" }).click();
      await expect.element(panel().getByRole("heading", { name: "Upcoming" })).toBeVisible();
    });
  });

  describe("Bookings", () => {
    it("lists a row with when, what, badges and a chevron, opening the Booking", async () => {
      serve({
        bookings: async () =>
          pageOf([
            makeBooking(0, { status: "pending" }),
            makeBooking(1, { kind: "evaluation", subject: null, location: "in_office" }),
          ]),
      });
      await renderApp("/staff/u-ana?tab=bookings");
      await expect
        .element(panel().getByText("Sat, Nov 1 · 3:30 PM – 4:30 PM"))
        .toBeVisible();
      await expect.element(panel().getByText("Emma Lee · Maths · Garcia home")).toBeVisible();
      await expect.element(panel().getByText("Emma Lee · Evaluation · In office")).toBeVisible();
      await expect.element(panel().getByText("Pending")).toBeVisible();
      await expect.element(panel().getByText("Evaluation", { exact: true })).toBeVisible();
      for (const row of rowButtons()) {
        expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(MIN_ROW_HEIGHT);
      }
      expectNoHorizontalScroll();
      await panel().getByRole("button", { name: /Sat, Nov 1/ }).click();
      // /bookings/:id opens the details, then drops back to /bookings.
      await expect.poll(getPath).toBe("/bookings");
      await expect
        .poll(() =>
          network.get.mock.calls.some(([u]) => String(u) === "/api/bookings/b-0"),
        )
        .toBe(true);
    });

    it("asks for this person's live Bookings and shows ten at most", async () => {
      const many = Array.from({ length: BOOKING_LIMIT + 2 }, (_, i) => makeBooking(i));
      serve({ bookings: async () => pageOf(many) });
      await renderApp("/staff/u-ana?tab=bookings");
      await expect.element(panel().getByText("Sat, Nov 1 ·")).toBeVisible();
      expect(rowButtons()).toHaveLength(BOOKING_LIMIT);
      const url = network.get.mock.calls.map(([u]) => String(u)).find((u) => u.startsWith("/api/bookings"));
      expect(url).toContain(`user_id=${ANA.id}`);
      expect(url).toContain("status=pending&status=confirmed");
    });

    it("leaves out today's sessions that already started", async () => {
      serve({
        bookings: async () =>
          pageOf([
            makeBooking(0, { scheduled_date: getTodayKey(), start_time: "00:00:00", end_time: "00:30:00" }),
            makeBooking(1),
          ]),
      });
      await renderApp("/staff/u-ana?tab=bookings");
      await expect.element(panel().getByText("Sun, Nov 2 ·")).toBeVisible();
      expect(rowButtons()).toHaveLength(1);
    });

    it("links See all in Bookings with ?staff=", async () => {
      await renderApp("/staff/u-ana?tab=bookings");
      await panel().getByRole("button", { name: "See all in Bookings" }).click();
      await expect.poll(getPath).toBe(`/bookings?staff=${ANA.id}`);
    });

    it("says nothing is booked, with See all still below", async () => {
      serve({ bookings: async () => pageOf([]) });
      await renderApp("/staff/u-ana?tab=bookings");
      await expect.element(panel().getByText("Nothing booked ahead")).toBeVisible();
      await expect.element(panel().getByRole("button", { name: "See all in Bookings" })).toBeVisible();
    });

    it("shows a skeleton while loading", async () => {
      serve({ bookings: never });
      await renderApp("/staff/u-ana?tab=bookings");
      await expect
        .element(panel().getByRole("status", { name: "Loading Bookings" }))
        .toBeVisible();
    });

    it("shows an error with Try again", async () => {
      serve({
        bookings: async () => {
          throw new Error("offline");
        },
      });
      await renderApp("/staff/u-mo?tab=bookings", "manager");
      await expect
        .element(
          panel().getByText("Couldn’t load their Bookings. Check your connection and try again."),
        )
        .toBeVisible();
      await expect.element(panel().getByRole("button", { name: "Try again" })).toBeVisible();
    });
  });
});
