import { AxiosError, AxiosHeaders } from "axios";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import BookingOverlaysProvider from "@/components/booking-overlays/booking-overlays-provider";
import KitRoot from "@/components/kit/kit-root";
import type { BookingDetail, BookingSummary } from "@/lib/queries/bookings";
import FamilyPage from "@/pages/families/family-page";
import { useAuthStore } from "@/stores/authStore";
import { renderWithProviders } from "@/test/render-with-providers";
import type { ChildDetail, HouseholdChild, HouseholdRead } from "@/types/families";

const network = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get, patch: network.patch },
}));

// Wednesday Oct 14 2026, 3 PM in the business time zone.
const NOW = new Date("2026-10-14T19:00:00Z");
const THIS_WEEK = "2026-10-12";
const PREVIOUS_WEEK = "2026-10-05";
const NEXT_WEEK = "2026-10-19";
const WEEK_AFTER_NEXT = "2026-10-26";
const MONDAY = "2026-10-12";
const WEDNESDAY = "2026-10-14";
const FRIDAY = "2026-10-16";

const SOFIA: HouseholdChild = { id: "c-1", name: "Sofia Souza", grade_level: 5, archived: false };
const MATEO: HouseholdChild = { id: "c-2", name: "Mateo Souza", grade_level: 3, archived: true };
const LUCAS: HouseholdChild = { id: "c-3", name: "Lucas Souza", grade_level: 2, archived: false };
const NINA: HouseholdChild = { id: "c-4", name: "Nina Souza", grade_level: 1, archived: false };
const BRUNA: HouseholdChild = { id: "c-5", name: "Bruna Souza", grade_level: 1, archived: false };

function makeHousehold(children: HouseholdChild[]): HouseholdRead {
  return {
    key: "g-1",
    name: "Laura & Diego Souza",
    archived: false,
    guardians: [],
    children,
    homes: [],
    next_booking: null,
  };
}

function makeChild({ id, name, archived }: HouseholdChild): ChildDetail {
  return {
    id,
    name,
    date_of_birth: null,
    grade_level: 5,
    school_name: "Lincoln Elementary",
    notes: null,
    archived,
    upcoming_session_count: 0,
    next_session: null,
    guardians: [],
    homes: [],
    levels: [],
    evaluated: null,
    assigned_tutors: [],
    evaluation_run_by: null,
  };
}

function makeBooking(overrides: Partial<BookingSummary> = {}): BookingSummary {
  return {
    id: "b-1",
    child: { id: SOFIA.id, name: SOFIA.name, notes: null },
    staff: { id: "u-ana", name: "Ana Brooks", role: "tutor" },
    kind: "regular",
    location: "home",
    subject: { id: "s-math", name: "Math" },
    scheduled_date: MONDAY,
    start_time: "15:30:00",
    end_time: "16:30:00",
    status: "confirmed",
    notes: null,
    updated_at: "2026-10-01T10:00:00Z",
    office_address: null,
    subject_level: 5,
    home: null,
    guardians: [],
    sort_out_reasons: [],
    clash_acknowledged_by: null,
    clash_acknowledged_at: null,
    ...overrides,
  };
}

function toDetail(booking: BookingSummary): BookingDetail {
  return {
    ...booking,
    home: null,
    location: "in_office",
    booked_by_guardian: null,
    guardians: [],
    availability_id: null,
    clashing_time_off: [],
    created_at: "2026-10-01T10:00:00Z",
  };
}

function httpError(status: number): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError(String(status), "ERR_BAD_REQUEST", config, null, {
    status,
    statusText: String(status),
    headers: {},
    config,
    data: {},
  });
}

type WeekResponse = BookingSummary[] | "fail" | "hang";

type Fixtures = {
  children?: HouseholdChild[];
  weeks?: Record<string, WeekResponse>;
};

let weeks: Record<string, WeekResponse> = {};

function serve({ children = [SOFIA, MATEO], weeks: byWeek = {} }: Fixtures = {}): void {
  weeks = byWeek;
  const household = makeHousehold(children);
  network.get.mockImplementation(async (url: string) => {
    const [path, query = ""] = url.split("?");
    if (path === "/api/households/g-1") return { data: household };
    const child = children.find((each) => path === `/api/children/${each.id}`);
    if (child) return { data: makeChild(child) };
    if (path === "/api/bookings") {
      const response = weeks[new URLSearchParams(query).get("from") ?? ""] ?? [];
      if (response === "fail") throw new Error("offline");
      if (response === "hang") return new Promise(() => {});
      return { data: { items: response, total: response.length, page: 1, page_size: 100 } };
    }
    const booking = Object.values(weeks)
      .flatMap((each) => (Array.isArray(each) ? each : []))
      .find((each) => path === `/api/bookings/${each.id}`);
    if (booking) return { data: toDetail(booking) };
    throw httpError(404);
  });
}

function LocationProbe(): ReactNode {
  const { pathname, search } = useLocation();
  return <output aria-label="Location">{`${pathname}${search}`}</output>;
}

async function renderFamily(): Promise<void> {
  await renderWithProviders(
    <MemoryRouter initialEntries={["/families/g-1"]}>
      <KitRoot theme="light" height="800px">
        <Routes>
          <Route
            path="*"
            element={
              <BookingOverlaysProvider>
                <Routes>
                  <Route path="/families/:memberId" element={<FamilyPage />} />
                  <Route path="/bookings" element={<p>Bookings page</p>} />
                </Routes>
              </BookingOverlaysProvider>
            }
          />
        </Routes>
      </KitRoot>
      <LocationProbe />
    </MemoryRouter>,
  );
  await expect.element(page.getByRole("heading", { name: "Bookings by week" })).toBeVisible();
}

function bookingRequests(): URLSearchParams[] {
  return network.get.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith("/api/bookings?"))
    .map((url) => new URLSearchParams(url.split("?")[1]));
}

const requestedWeeks = () => bookingRequests().map((params) => params.get("from"));
const section = () => page.getByRole("region", { name: "Bookings by week" });
const range = () => section().getByText(/–/);
const block = (name: string | RegExp) => section().getByRole("button", { name });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  await page.viewport(1280, 800);
  network.get.mockReset();
  network.patch.mockReset();
  useAuthStore.setState({ status: "authenticated", role: "admin" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("week navigation", () => {
  it("opens on the current week with today marked", async () => {
    serve({ weeks: { [THIS_WEEK]: [makeBooking()] } });
    await renderFamily();

    await expect.element(range()).toHaveTextContent("Oct 12 – 18");
    await expect.element(range()).toHaveAttribute("aria-live", "polite");
    await expect.element(section().getByText("Wed 14 (today)")).toBeVisible();
    await expect.element(section().getByRole("button", { name: "This week" })).toBeDisabled();
  });

  it("moves with Previous, Next and This week, crossing months", async () => {
    serve();
    await renderFamily();

    await section().getByRole("button", { name: "Next week" }).click();
    await expect.element(range()).toHaveTextContent("Oct 19 – 25");
    await expect.element(section().getByRole("button", { name: "This week" })).toBeEnabled();

    await section().getByRole("button", { name: "Next week" }).click();
    await section().getByRole("button", { name: "Next week" }).click();
    await expect.element(range()).toHaveTextContent("Nov 2 – 8");
    await section().getByRole("button", { name: "Previous week" }).click();
    await expect.element(range()).toHaveTextContent("Oct 26 – Nov 1");

    await section().getByRole("button", { name: "This week" }).click();
    await expect.element(range()).toHaveTextContent("Oct 12 – 18");
    await expect.element(section().getByRole("button", { name: "This week" })).toBeDisabled();
  });

  it("adds the year to a week that crosses into the next one", async () => {
    vi.setSystemTime(new Date("2026-12-30T17:00:00Z"));
    serve();
    await renderFamily();

    await expect.element(range()).toHaveTextContent("Dec 28, 2026 – Jan 3, 2027");
  });
});

describe("data", () => {
  it("asks for every family Child, archived included, the whole week and every status", async () => {
    serve();
    await renderFamily();

    await vi.waitFor(() => expect(requestedWeeks()).toContain(THIS_WEEK));
    const [first] = bookingRequests();
    expect(first.getAll("child_id")).toEqual([SOFIA.id, MATEO.id]);
    expect(first.get("from")).toBe(THIS_WEEK);
    expect(first.get("to")).toBe("2026-10-18");
    expect(first.getAll("status")).toEqual([]);
  });

  it("preloads the weeks either side, and the next one beyond on each move", async () => {
    serve({ weeks: { [NEXT_WEEK]: [makeBooking({ id: "b-next", scheduled_date: "2026-10-20" })] } });
    await renderFamily();

    await vi.waitFor(() =>
      expect(requestedWeeks()).toEqual(expect.arrayContaining([PREVIOUS_WEEK, NEXT_WEEK])),
    );
    // The current week loads before its neighbours.
    expect(requestedWeeks()[0]).toBe(THIS_WEEK);

    await section().getByRole("button", { name: "Next week" }).click();
    // Already loaded: the week swaps in with no skeleton.
    expect(page.getByRole("status", { name: "Loading Bookings" }).elements()).toHaveLength(0);
    await expect.element(block(/^3:30 PM, Sofia Souza/)).toBeVisible();
    await vi.waitFor(() => expect(requestedWeeks()).toContain(WEEK_AFTER_NEXT));
  });

  it("shows the week's shape while an uncached week loads", async () => {
    serve({ weeks: { [THIS_WEEK]: "hang" } });
    await renderFamily();

    await expect.element(page.getByRole("status", { name: "Loading Bookings" })).toBeInTheDocument();
    await expect.element(range()).toHaveTextContent("Oct 12 – 18");
  });

  it("says the week couldn't load, and Try again loads it", async () => {
    serve({ weeks: { [THIS_WEEK]: "fail" } });
    await renderFamily();

    const error = section().getByRole("alert");
    await expect.element(error).toHaveTextContent("Couldn’t load Bookings. Check your connection.");

    weeks = { [THIS_WEEK]: [makeBooking()] };
    await error.getByRole("button", { name: "Try again" }).click();
    await expect.element(block(/^3:30 PM, Sofia Souza/)).toBeVisible();
  });

  it("shows an empty week as one quiet well", async () => {
    serve();
    await renderFamily();

    await expect.element(section().getByText("Nothing booked this week")).toBeVisible();
    expect(section().getByText(/Try another week/).elements()).toHaveLength(0);
    expect(section().getByText("Mon 12").elements()).toHaveLength(0);
  });

  it("opens Bookings filtered to the family's Children", async () => {
    serve();
    await renderFamily();

    await section().getByRole("button", { name: "See all in Bookings" }).click();
    await expect.element(page.getByText("Bookings page")).toBeVisible();
    await expect
      .element(page.getByRole("status", { name: "Location" }))
      .toHaveTextContent(`/bookings?child=${SOFIA.id}&child=${MATEO.id}`);
  });
});

describe("blocks", () => {
  function barColour(name: RegExp): string {
    return getComputedStyle(block(name).element()).borderLeftColor;
  }

  function dotColour(firstName: string): string | null {
    const item = section()
      .getByRole("list", { name: "Children" })
      .getByRole("listitem")
      .filter({ hasText: firstName })
      .element();
    const dot = item.querySelector("[aria-hidden]");
    return dot ? getComputedStyle(dot).backgroundColor : null;
  }

  it("colours each Child in family order, the fifth on neutral and named in the legend", async () => {
    const children = [SOFIA, MATEO, LUCAS, NINA, BRUNA];
    serve({
      children,
      weeks: {
        [THIS_WEEK]: children.map((child, index) =>
          makeBooking({
            id: `b-${child.id}`,
            child: { id: child.id, name: child.name, notes: null },
            start_time: `${10 + index}:00:00`,
          }),
        ),
      },
    });
    await renderFamily();

    await expect.element(block(/Bruna Souza/)).toBeVisible();
    const legend = section().getByRole("list", { name: "Children" });
    await expect.element(legend).toHaveTextContent("SofiaMateoLucasNinaBruna");

    const colours = [SOFIA, MATEO, LUCAS, NINA].map((child) => {
      const [firstName] = child.name.split(" ");
      const colour = barColour(new RegExp(child.name));
      expect(dotColour(firstName)).toBe(colour);
      return colour;
    });
    expect(new Set(colours).size).toBe(4);
    expect(dotColour("Bruna")).toBeNull();
    expect(colours).not.toContain(barColour(/Bruna Souza/));
  });

  it("hides the legend for one Child", async () => {
    serve({ children: [SOFIA], weeks: { [THIS_WEEK]: [makeBooking()] } });
    await renderFamily();

    await expect.element(block(/^3:30 PM, Sofia Souza/)).toBeVisible();
    expect(section().getByRole("list", { name: "Children" }).elements()).toHaveLength(0);
  });

  it("shows time, first name, Subject and Staff, and an Evaluation with its label", async () => {
    serve({
      weeks: {
        [THIS_WEEK]: [
          makeBooking(),
          makeBooking({ id: "b-2", kind: "evaluation", subject: null, scheduled_date: FRIDAY }),
        ],
      },
    });
    await renderFamily();

    const tutoring = block("3:30 PM, Sofia Souza, Math with Ana Brooks, Confirmed");
    await expect.element(tutoring).toHaveTextContent("3:30 PMSofiaMathAna Brooks");
    await expect
      .element(block("3:30 PM, Sofia Souza, Evaluation with Ana Brooks, Confirmed"))
      .toHaveTextContent("3:30 PMSofiaEvaluationAna Brooks");
  });

  it("marks Pending and Cancelled Bookings", async () => {
    serve({
      weeks: {
        [THIS_WEEK]: [
          makeBooking({ status: "pending" }),
          makeBooking({ id: "b-2", status: "cancelled", scheduled_date: FRIDAY }),
        ],
      },
    });
    await renderFamily();

    await expect
      .element(block("3:30 PM, Sofia Souza, Math with Ana Brooks, Pending"))
      .toHaveTextContent("3:30 PM · Pending");
    const cancelled = block("3:30 PM, Sofia Souza, Math with Ana Brooks, Cancelled");
    await expect.element(cancelled).toHaveTextContent("Cancelled");
    const name = cancelled.getByText("Sofia", { exact: true }).element();
    expect(getComputedStyle(name).textDecorationLine).toBe("line-through");
    expect(getComputedStyle(cancelled.element()).opacity).toBe("1");
  });

  // The grid at 1280 with the app sidebar open is about this narrow: ~123px columns.
  it("shows the whole status in a narrow grid column", async () => {
    await page.viewport(960, 800);
    serve({ weeks: { [THIS_WEEK]: [makeBooking({ start_time: "16:00:00", status: "pending" })] } });
    await renderFamily();

    const pending = block("4:00 PM, Sofia Souza, Math with Ana Brooks, Pending");
    await expect.element(pending).toBeVisible();
    const status = pending.getByText("· Pending").element();
    const timeLine = status.parentElement as HTMLElement;
    expect(status.getBoundingClientRect().right).toBeLessThanOrEqual(
      pending.element().getBoundingClientRect().right,
    );
    expect(timeLine.scrollWidth).toBeLessThanOrEqual(timeLine.clientWidth);
  });

  it("stacks a day's Bookings in start-time order", async () => {
    serve({
      weeks: {
        [THIS_WEEK]: [
          makeBooking({ id: "late", start_time: "17:00:00" }),
          makeBooking({ id: "early", start_time: "09:00:00" }),
        ],
      },
    });
    await renderFamily();

    await expect.element(block(/^9:00 AM/)).toBeVisible();
    const times = section()
      .getByRole("button", { name: /Sofia Souza/ })
      .elements()
      .map((element) => element.getAttribute("aria-label")?.split(",")[0]);
    expect(times).toEqual(["9:00 AM", "5:00 PM"]);
  });

  it("opens Booking details, and the week shows the new status after an action", async () => {
    // Earlier today, so it can be marked Completed.
    const booking = makeBooking({ scheduled_date: WEDNESDAY, start_time: "10:00:00", end_time: "11:00:00" });
    serve({ weeks: { [THIS_WEEK]: [booking] } });
    network.patch.mockResolvedValue({
      data: { ...booking, status: "completed", updated_at: "2026-10-14T19:00:00Z" },
    });
    await renderFamily();

    await block(/^10:00 AM, Sofia Souza/).click();
    const details = page.getByRole("dialog");
    await expect.element(details).toBeVisible();

    weeks = { [THIS_WEEK]: [{ ...booking, status: "completed" }] };
    await userEvent.click(details.getByRole("button", { name: "Completed" }));
    await expect.element(details).not.toBeInTheDocument();
    await expect
      .element(block("10:00 AM, Sofia Souza, Math with Ana Brooks, Completed"))
      .toBeVisible();
  });
});

describe("layout", () => {
  it("lays the week out as a 7-day grid at 1280", async () => {
    serve({ weeks: { [THIS_WEEK]: [makeBooking()] } });
    await renderFamily();

    for (const header of ["Mon 12", "Tue 13", "Thu 15", "Fri 16", "Sat 17", "Sun 18"]) {
      await expect.element(section().getByText(header, { exact: true })).toBeVisible();
    }
    const today = section().getByText("Wed 14 (today)").element().parentElement as HTMLElement;
    const monday = section().getByText("Mon 12", { exact: true }).element().parentElement as HTMLElement;
    expect(getComputedStyle(today).backgroundColor).not.toBe(getComputedStyle(monday).backgroundColor);
    for (const dash of section().getByText("—").elements()) {
      expect(dash).not.toBeVisible();
    }
  });

  it("lists the week day by day at 390", async () => {
    await page.viewport(390, 800);
    serve({ weeks: { [THIS_WEEK]: [makeBooking()] } });
    await renderFamily();

    await expect.element(section().getByText("Mon Oct 12")).toBeVisible();
    await expect.element(section().getByText("Today", { exact: true })).toBeVisible();
    expect(section().getByText("—").elements()).toHaveLength(6);
    await expect.element(section().getByText("Mon 12", { exact: true })).not.toBeVisible();
  });

  it("doesn't scroll sideways at 320", async () => {
    await page.viewport(320, 800);
    serve({ children: [SOFIA, MATEO, LUCAS, NINA, BRUNA], weeks: { [THIS_WEEK]: [makeBooking()] } });
    await renderFamily();

    await expect.element(block(/^3:30 PM, Sofia Souza/)).toBeVisible();
    const element = section().element();
    expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth);
  });
});
