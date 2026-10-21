import { AxiosError, type AxiosResponse } from "axios";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import KitRoot from "@/components/kit/kit-root";
import type { BookingDetail, BookingSummary } from "@/lib/queries/bookings";
import MySessionsPage from "@/pages/sessions/my-sessions-page";
import { useAuthStore } from "@/stores/authStore";
import { renderWithProviders } from "@/test/render-with-providers";

// 3:05 PM on Tuesday, October 20 2026 in New York.
const NOW = new Date("2026-10-20T19:05:00Z");
const OFFICE_PHONE = "+13055550100";

const network = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get, patch: network.patch },
}));

type Me = { id: string; email: string; role: "tutor"; name: string; office_phone: string | null };

const ME: Me = {
  id: "u-ana",
  email: "ana@example.com",
  role: "tutor",
  name: "Ana Souza",
  office_phone: OFFICE_PHONE,
};

function makeSummary(
  id: string,
  overrides: Partial<BookingSummary> & Pick<BookingSummary, "scheduled_date" | "start_time" | "end_time">,
): BookingSummary {
  return {
    id,
    child: { id: `c-${id}`, name: "Emma Garcia", notes: null },
    staff: { id: ME.id, name: ME.name, role: "tutor" },
    kind: "regular",
    location: "home",
    office_address: null,
    subject: { id: "sub-maths", name: "Maths" },
    subject_level: 5,
    status: "confirmed",
    notes: null,
    home: { id: "h-1", label: "Garcia", address: "12 Oak St, Springfield", directions: "Ring the side door." },
    guardians: [{ id: "g-1", name: "Maria Garcia" }],
    sort_out_reasons: [],
    clash_acknowledged_by: null,
    clash_acknowledged_at: null,
    updated_at: "2026-10-01T12:00:00Z",
    ...overrides,
  };
}

function makeDetail(summary: BookingSummary, overrides: Partial<BookingDetail> = {}): BookingDetail {
  return {
    ...summary,
    home: summary.home && { ...summary.home, access_code: "" },
    booked_by_guardian: null,
    guardians: summary.guardians.map((guardian) => ({ ...guardian, conversation_id: null })),
    availability_id: null,
    clashing_time_off: [],
    created_at: "2026-09-28T15:00:00Z",
    ...overrides,
  };
}

const IAN = makeSummary("s-ian", {
  child: { id: "c-ian", name: "Ian Fox", notes: null },
  scheduled_date: "2026-10-20",
  start_time: "10:00:00",
  end_time: "10:30:00",
  status: "didnt_happen",
});
const ZOE = makeSummary("s-zoe", {
  child: { id: "c-zoe", name: "Zoe Kim", notes: null },
  scheduled_date: "2026-10-20",
  start_time: "11:00:00",
  end_time: "12:00:00",
  status: "completed",
});
const LEO = makeSummary("s-leo", {
  child: { id: "c-leo", name: "Leo Park", notes: null },
  scheduled_date: "2026-10-20",
  start_time: "13:00:00",
  end_time: "14:00:00",
  subject: { id: "sub-reading", name: "Reading" },
  subject_level: 3,
  location: "in_office",
  home: null,
  office_address: "1 Main St, Doral",
});
const EMMA = makeSummary("s-emma", {
  child: { id: "c-emma", name: "Emma Garcia", notes: "Loves fractions." },
  scheduled_date: "2026-10-20",
  start_time: "15:30:00",
  end_time: "16:30:00",
});
const MIA = makeSummary("s-mia", {
  child: { id: "c-mia", name: "Mia Chen", notes: null },
  scheduled_date: "2026-10-20",
  start_time: "17:00:00",
  end_time: "18:00:00",
  status: "cancelled",
});
const NOAH = makeSummary("s-noah", {
  child: { id: "c-noah", name: "Noah Diaz", notes: null },
  scheduled_date: "2026-10-21",
  start_time: "09:00:00",
  end_time: "10:00:00",
  kind: "evaluation",
  subject: null,
  subject_level: null,
  status: "pending",
  location: "in_office",
  home: null,
});
const AVA = makeSummary("s-ava", {
  child: { id: "c-ava", name: "Ava Lee", notes: null },
  scheduled_date: "2026-10-22",
  start_time: "16:00:00",
  end_time: "17:00:00",
  subject_level: null,
  home: { id: "h-2", label: null, address: "40 Pine Rd", directions: null },
});

const UPCOMING = [IAN, ZOE, LEO, EMMA, MIA, NOAH, AVA];

// Thirty past Sessions, one a day through September, soonest first like the API.
const PAST = Array.from({ length: 30 }, (_, index) => {
  const day = String(index + 1).padStart(2, "0");
  return makeSummary(`s-past-${day}`, {
    child: { id: `c-past-${day}`, name: `Child Sep${day}`, notes: null },
    scheduled_date: `2026-09-${day}`,
    start_time: "15:00:00",
    end_time: "16:00:00",
    status: "completed",
  });
});

type Fixtures = {
  me: Me;
  upcoming: BookingSummary[];
  past: BookingSummary[];
  details: Map<string, BookingDetail>;
};

let fixtures: Fixtures;

function respond<T>(data: T): Promise<{ data: T }> {
  return Promise.resolve({ data });
}

function failWith(status: number): Promise<never> {
  const response = { status, data: {}, headers: {}, statusText: "", config: {} } as AxiosResponse;
  return Promise.reject(new AxiosError("Request failed", String(status), undefined, undefined, response));
}

function listPage(items: BookingSummary[], search: URLSearchParams) {
  const pageNumber = Number(search.get("page"));
  const pageSize = Number(search.get("page_size"));
  const start = (pageNumber - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total: items.length,
    page: pageNumber,
    page_size: pageSize,
    counts_by_kind: { regular: 0, evaluation: 0 },
  };
}

function handleGet(url: string) {
  const [path, query] = url.split("?");
  const search = new URLSearchParams(query);
  if (path === "/api/me") return respond(fixtures.me);
  if (path === "/api/bookings" && search.has("from")) return respond(listPage(fixtures.upcoming, search));
  if (path === "/api/bookings" && search.has("to")) return respond(listPage(fixtures.past, search));
  const detail = fixtures.details.get(path.replace("/api/bookings/", ""));
  return detail ? respond(detail) : failWith(404);
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

async function renderAt(entry: string) {
  const element = (
    <KitRoot theme="light">
      <MySessionsPage />
      <LocationProbe />
    </KitRoot>
  );
  return renderWithProviders(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/sessions" element={element} />
        <Route path="/sessions/:id" element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

// A token's colour as the browser computes it, read from a probe beside `near`.
function resolveColor(near: HTMLElement, color: string): string {
  const probe = document.createElement("span");
  probe.style.backgroundColor = color;
  near.append(probe);
  const resolved = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return resolved;
}

const location = () => page.getByTestId("location");
const details = () => page.getByRole("dialog", { name: /^Session/ });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  fixtures = {
    me: ME,
    upcoming: UPCOMING,
    past: PAST,
    details: new Map(
      [...UPCOMING, ...PAST].map((summary) => [summary.id, makeDetail(summary)]),
    ),
  };
  network.get.mockReset();
  network.patch.mockReset();
  network.get.mockImplementation(handleGet);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("welcome card", () => {
  it("shows the Tutor's card under the header while the welcome is unseen", async () => {
    fixtures.me = { ...ME, welcome_seen: false } as Me;
    useAuthStore.setState({ status: "authenticated", role: "tutor" });
    await renderAt("/sessions");

    await expect
      .element(page.getByRole("region", { name: "Welcome to TutorLink" }))
      .toBeVisible();
  });
});

describe.each([
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
])("at $width px", ({ width, height }) => {
  const isPhone = width < 672;

  beforeEach(async () => {
    await page.viewport(width, height);
  });

  describe("header", () => {
    it("shows today's date, a greeting with the first name and today's count", async () => {
      await renderAt("/sessions");

      await expect.element(page.getByText("Tuesday, October 20")).toBeVisible();
      await expect
        .element(page.getByRole("heading", { level: 1, name: "Good afternoon, Ana" }))
        .toBeVisible();
      await expect.element(page.getByText("4 sessions today.")).toBeVisible();
      await expect.element(page.getByRole("button", { name: "Upcoming" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("says No sessions today when the next one is later", async () => {
      fixtures.upcoming = [NOAH];
      await renderAt("/sessions");

      await expect.element(page.getByText("No sessions today.")).toBeVisible();
    });

    it("says No sessions coming up, with an empty state and no buttons, when nothing is booked", async () => {
      fixtures.upcoming = [];
      await renderAt("/sessions");

      await expect.element(page.getByText("No sessions coming up.")).toBeVisible();
      await expect.element(page.getByRole("heading", { name: "Nothing booked yet" })).toBeVisible();
      expect(page.getByRole("button").elements().map((button) => button.textContent)).toEqual([
        "Upcoming",
        "Past",
      ]);
    });
  });

  describe("Upcoming", () => {
    it("shows the Next up card with when, who, what and where", async () => {
      await renderAt("/sessions");
      const card = page.getByRole("region", { name: "Next up" });

      await expect.element(card).toHaveTextContent("Next up · In 25 min");
      await expect.element(card).toHaveTextContent("3:30 PM – 4:30 PM");
      await expect.element(card).toHaveTextContent("Emma Garcia");
      await expect.element(card).toHaveTextContent("Maths · Grade 5");
      await expect.element(card).toHaveTextContent("Garcia home · 12 Oak St, Springfield");
      await expect.element(card).toHaveTextContent("Has directions · tap for details");
      expect(card.getByRole("button").elements()).toHaveLength(1);
    });

    it("opens the details from the Next up card", async () => {
      await renderAt("/sessions");
      await page.getByRole("region", { name: "Next up" }).getByRole("button").click();

      await expect.element(location()).toHaveTextContent("/sessions/s-emma");
      await expect.element(details()).toHaveAccessibleName("Session with Emma Garcia");
    });

    it("groups the rest by day, under Today, Tomorrow and the weekday", async () => {
      await renderAt("/sessions");
      await expect.element(page.getByRole("region", { name: "Next up" })).toBeVisible();

      const headings = page.getByRole("heading", { level: 2 }).elements().map((h) => h.textContent);
      expect(headings).toEqual(["TodayOct 20", "TomorrowOct 21", "ThursdayOct 22"]);
      const today = page.getByRole("region", { name: "Today Oct 20" });
      expect(today.getByRole("listitem").elements()).toHaveLength(4);
    });

    it("badges and mutes rows by kind and status", async () => {
      await renderAt("/sessions");
      const row = (name: string) => page.getByRole("button", { name: new RegExp(name) });

      await expect.element(row("Noah Diaz")).toHaveTextContent("Evaluation");
      await expect.element(row("Noah Diaz")).toHaveTextContent("Evaluation session");
      await expect.element(row("Leo Park")).toHaveTextContent("Not marked");
      await expect.element(row("Leo Park")).toHaveTextContent("In office · 1 Main St, Doral");
      await expect.element(row("Mia Chen")).toHaveTextContent("Cancelled");
      await expect
        .element(row("Mia Chen").getByText("Mia Chen"))
        .toHaveClass("line-through");
      await expect.element(row("Zoe Kim")).toHaveTextContent("Completed");
      await expect.element(row("Ian Fox")).toHaveTextContent("Didn’t happen");
      await expect.element(row("Ian Fox")).toHaveClass("text-(--tl-muted)");
      await expect.element(row("Ava Lee")).toHaveTextContent("Maths · No level yet");
      await expect.element(row("Ava Lee")).toHaveTextContent("to 5:00");
    });

    it("never says Booking", async () => {
      await renderAt("/sessions/s-noah");
      await expect.element(details()).toBeVisible();

      expect(document.body.textContent).not.toMatch(/booking/i);
    });
  });

  describe("Past", () => {
    it("lists the most recent first and pages back with the Pager", async () => {
      await renderAt("/sessions");
      await page.getByRole("button", { name: "Past" }).click();

      await expect.element(location()).toHaveTextContent("/sessions?view=past");
      await expect.element(page.getByRole("button", { name: /Child Sep30/ })).toBeVisible();
      const firstGroup = page.getByRole("heading", { level: 2 }).first();
      await expect.element(firstGroup).toHaveTextContent("Sep 30");
      expect(page.getByRole("button", { name: /Child Sep/ }).elements()).toHaveLength(25);
      expect(page.getByRole("region", { name: "Next up" }).elements()).toHaveLength(0);
      const pager = page.getByRole("navigation", { name: "Past sessions pages" });
      await expect.element(pager).toHaveTextContent(isPhone ? "Page 1 of 2" : "1–25 of 30");
      const pastCall = network.get.mock.calls.find(([url]) => String(url).includes("to="));
      expect(String(pastCall?.[0])).toContain("to=2026-10-19");

      await pager.getByRole("button", { name: isPhone ? "Next page" : "Next" }).click();

      await expect.element(page.getByRole("button", { name: /Child Sep05/ })).toBeVisible();
      expect(
        page
          .getByRole("button", { name: /Child Sep/ })
          .elements()
          .map((row) => row.textContent?.match(/Child Sep\d\d/)?.[0]),
      ).toEqual(["Child Sep05", "Child Sep04", "Child Sep03", "Child Sep02", "Child Sep01"]);
      await expect.element(page.getByRole("heading", { level: 2 }).first()).toHaveTextContent("Sep 5");
      await expect.element(location()).toHaveTextContent("/sessions?view=past&page=2");
    });

    it("shows the empty state and keeps the Pager on a page past the end", async () => {
      await renderAt("/sessions?view=past&page=5");

      await expect.element(page.getByRole("heading", { name: "No past sessions" })).toBeVisible();
      await expect
        .element(page.getByRole("navigation", { name: "Past sessions pages" }))
        .toBeVisible();
    });

    it("says No past sessions with no buttons when there are none", async () => {
      fixtures.past = [];
      await renderAt("/sessions?view=past");

      await expect.element(page.getByRole("heading", { name: "No past sessions" })).toBeVisible();
      expect(page.getByRole("button").elements()).toHaveLength(2);
    });
  });

  describe("loading and errors", () => {
    it("shows the list skeleton while loading", async () => {
      network.get.mockImplementation((url: string) =>
        url === "/api/me" ? respond(ME) : new Promise(() => {}),
      );
      await renderAt("/sessions");

      await expect.element(page.getByRole("status", { name: "Loading your sessions" })).toBeVisible();
      expect(page.getByRole("button").elements()).toHaveLength(2);
    });

    it("offers Try again when the list fails, and loads on retry", async () => {
      network.get.mockImplementation((url: string) =>
        url.startsWith("/api/bookings") ? failWith(500) : handleGet(url),
      );
      await renderAt("/sessions");

      await expect.element(page.getByRole("heading", { name: "Couldn’t load your sessions" })).toBeVisible();
      await expect.element(page.getByText("Check your connection and try again.")).toBeVisible();

      network.get.mockImplementation(handleGet);
      await page.getByRole("button", { name: "Try again" }).click();
      await expect.element(page.getByRole("region", { name: "Next up" })).toBeVisible();
    });
  });

  describe("Session details", () => {
    it("shows a Home session with directions, notes, Guardians and the office's phone", async () => {
      fixtures.details.set(
        EMMA.id,
        makeDetail(EMMA, {
          booked_by_guardian: { id: "g-1", name: "Maria Garcia" },
          guardians: [
            { id: "g-1", name: "Maria Garcia", conversation_id: null },
            { id: "g-2", name: "Carlos Garcia", conversation_id: null },
          ],
        }),
      );
      await renderAt("/sessions/s-emma");
      const panel = details();

      await expect.element(panel.getByRole("heading", { name: "Emma Garcia" })).toBeVisible();
      await expect.element(panel).toHaveTextContent("Tuesday, October 20");
      await expect.element(panel).toHaveTextContent("3:30 PM – 4:30 PM · 60 min");
      await expect.element(panel).toHaveTextContent("Subject levelMaths · Grade 5");
      await expect.element(panel).toHaveTextContent("Loves fractions.");
      await expect.element(panel).toHaveTextContent("Garcia home");
      await expect.element(panel).toHaveTextContent("12 Oak St, Springfield");
      await expect.element(panel).toHaveTextContent("Ring the side door.");
      const directions = panel.getByRole("link", { name: "Get directions (opens in a new tab)" });
      await expect.element(directions).toHaveAttribute(
        "href",
        "https://www.google.com/maps/search/?api=1&query=12%20Oak%20St%2C%20Springfield",
      );
      await expect.element(directions).toHaveAttribute("target", "_blank");
      // The link sits on the plain surface, so it stands out from the sunk well around it.
      const well = directions.element().parentElement as HTMLElement;
      const linkBackground = getComputedStyle(directions.element()).backgroundColor;
      expect(linkBackground).not.toBe(getComputedStyle(well).backgroundColor);
      expect(linkBackground).toBe(resolveColor(well, "var(--tl-surface)"));
      await expect.element(directions).toHaveAttribute("rel", "noreferrer");
      await expect.element(panel).toHaveTextContent("GuardiansMaria Garcia, Carlos Garcia");
      await expect
        .element(panel)
        .toHaveTextContent(
          "Booked by Maria through the bot. To reach them, call the office at +1 (305) 555-0100.",
        );
      await expect
        .element(panel.getByRole("link", { name: "Call the office" }))
        .toHaveAttribute("href", `tel:${OFFICE_PHONE}`);
      expect(panel.element().querySelectorAll('a[href^="mailto:"]')).toHaveLength(0);
      expect(panel.element().querySelectorAll('a[href^="tel:"]')).toHaveLength(1);
      expect(panel.element().textContent).not.toContain("@");
    });

    it("says when a Home has no directions", async () => {
      await renderAt("/sessions/s-ava");

      await expect.element(details()).toHaveTextContent("No directions saved for this Home.");
      await expect.element(details()).toHaveTextContent("Maths · No level yet");
      await expect.element(details()).toHaveTextContent("No Child notes from the office.");
      await expect.element(details()).toHaveTextContent("Booked by the office.");
    });

    it("shows In office with the office address and no directions", async () => {
      await renderAt("/sessions/s-leo");

      await expect.element(details()).toHaveTextContent("LocationIn office1 Main St, Doral");
      expect(details().getByRole("link", { name: /Get directions/ }).elements()).toHaveLength(0);
    });

    it("shows an Evaluation in office without an address", async () => {
      await renderAt("/sessions/s-noah");

      await expect.element(details()).toHaveTextContent("WhatEvaluation session");
      await expect.element(details()).toHaveTextContent("You’ll assess their Subject levels.");
      await expect.element(details()).toHaveTextContent("LocationIn officeGuardian");
    });

    it("leaves out Call the office, and the number, when the office has no phone", async () => {
      fixtures.me = { ...ME, office_phone: null };
      await renderAt("/sessions/s-ava");

      await expect.element(details()).toHaveTextContent("To reach them, call the office.");
      expect(details().getByRole("link", { name: "Call the office" }).elements()).toHaveLength(0);
    });

    it("draws no footer when there is nothing to mark and no office phone", async () => {
      fixtures.me = { ...ME, office_phone: null };
      await renderAt("/sessions/s-ava");
      await expect.element(details()).toHaveTextContent("To reach them, call the office.");

      expect(details().element().querySelector(":scope > .border-t")).toBeNull();
    });

    it("shows not found, with a way back, for an unknown or someone else's session", async () => {
      await renderAt("/sessions/s-missing?view=past");

      await expect.element(page.getByRole("heading", { name: "Couldn’t find this session" })).toBeVisible();
      await page.getByRole("button", { name: "Back to My sessions" }).click();
      await expect.element(location()).toHaveTextContent("/sessions?view=past");
    });

    it("encodes the id from the URL before asking the API", async () => {
      await renderAt("/sessions/..%2F..%2Fme");

      await expect
        .element(page.getByRole("heading", { name: "Couldn’t find this session" }))
        .toBeVisible();
      expect(network.get).toHaveBeenCalledWith("/api/bookings/..%2F..%2Fme");
      expect(network.get.mock.calls.filter(([url]) => url === "/api/me")).toHaveLength(1);
    });

    it("treats a 403 as not found", async () => {
      network.get.mockImplementation((url: string) =>
        url === "/api/bookings/s-other" ? failWith(403) : handleGet(url),
      );
      await renderAt("/sessions/s-other");

      await expect.element(page.getByRole("heading", { name: "Couldn’t find this session" })).toBeVisible();
    });

    it("opens from a deep link and goes back to the list, keeping the view", async () => {
      await renderAt("/sessions/s-emma?view=past");
      await expect.element(details()).toBeVisible();

      const back = isPhone
        ? details().getByRole("button", { name: "My sessions" })
        : details().getByRole("button", { name: "Close" });
      await back.click();

      await expect.element(location()).toHaveTextContent("/sessions?view=past");
      await expect.element(page.getByRole("button", { name: "Past" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
  });

  describe("Mark completed", () => {
    it("is offered only on a Confirmed session that has started", async () => {
      await renderAt("/sessions/s-emma");
      await expect.element(details().getByRole("link", { name: "Call the office" })).toBeVisible();
      expect(page.getByRole("button", { name: "Mark completed" }).elements()).toHaveLength(0);
    });

    it("is not offered on a Pending session", async () => {
      fixtures.details.set(LEO.id, makeDetail({ ...LEO, status: "pending" }));
      await renderAt("/sessions/s-leo");
      await expect.element(details()).toHaveTextContent("Not marked");
      expect(page.getByRole("button", { name: "Mark completed" }).elements()).toHaveLength(0);
    });

    it("asks first, then marks it with a toast and no Undo, and focuses the Child's name", async () => {
      network.patch.mockImplementation((url: string) => {
        const id = url.replace("/api/bookings/", "");
        const current = fixtures.details.get(id) as BookingDetail;
        fixtures.details.set(id, { ...current, status: "completed" });
        return respond({ id, status: "completed" });
      });
      await renderAt("/sessions/s-leo");
      await expect.element(details()).toHaveTextContent("Not marked");

      await details().getByRole("button", { name: "Mark completed" }).click();
      const confirm = page.getByRole("dialog", { name: "Mark this session completed?" });
      await expect.element(confirm).toHaveTextContent("The office can re-open it if it’s a mistake.");
      await expect.element(confirm.getByRole("button", { name: "Not yet" })).toBeVisible();
      await confirm.getByRole("button", { name: "Mark completed" }).click();

      await expect.element(page.getByText("Session with Leo marked Completed.")).toBeVisible();
      expect(network.patch).toHaveBeenCalledWith("/api/bookings/s-leo", {
        status: "completed",
        expected_updated_at: LEO.updated_at,
      });
      expect(page.getByRole("button", { name: "Undo" }).elements()).toHaveLength(0);
      await expect.element(details()).toHaveTextContent("Completed");
      await expect.element(details()).not.toHaveTextContent("Not marked");
      expect(details().getByRole("button", { name: "Mark completed" }).elements()).toHaveLength(0);
      await expect.element(details().getByRole("heading", { name: "Leo Park" })).toHaveFocus();
    });

    it("keeps it as it was when Not yet is chosen", async () => {
      await renderAt("/sessions/s-leo");
      await details().getByRole("button", { name: "Mark completed" }).click();
      await page.getByRole("button", { name: "Not yet" }).click();

      await expect
        .element(page.getByRole("dialog", { name: "Mark this session completed?" }))
        .not.toBeInTheDocument();
      expect(network.patch).not.toHaveBeenCalled();
    });

    it("shows not found when the refetch after a refusal says it isn't theirs any more", async () => {
      network.patch.mockImplementation(() => failWith(403));
      await renderAt("/sessions/s-leo");
      await details().getByRole("button", { name: "Mark completed" }).click();
      network.get.mockImplementation((url: string) =>
        url === "/api/bookings/s-leo" ? failWith(403) : handleGet(url),
      );
      await page
        .getByRole("dialog", { name: "Mark this session completed?" })
        .getByRole("button", { name: "Mark completed" })
        .click();

      await expect
        .element(page.getByRole("heading", { name: "Couldn’t find this session" }))
        .toBeVisible();
      expect(page.getByRole("button", { name: "Mark completed" }).elements()).toHaveLength(0);
    });

    it("toasts an error and refetches when the office refuses it", async () => {
      network.patch.mockImplementation(() => failWith(409));
      await renderAt("/sessions/s-leo");
      await details().getByRole("button", { name: "Mark completed" }).click();
      const detailCalls = () =>
        network.get.mock.calls.filter(([url]) => url === "/api/bookings/s-leo").length;
      const before = detailCalls();
      await page
        .getByRole("dialog", { name: "Mark this session completed?" })
        .getByRole("button", { name: "Mark completed" })
        .click();

      await expect
        .element(page.getByText("Couldn’t mark it completed. Refresh and try again."))
        .toBeVisible();
      await expect.poll(detailCalls).toBeGreaterThan(before);
      await expect.element(details()).toHaveTextContent("Not marked");
    });
  });
});
