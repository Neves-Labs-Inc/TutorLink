import type { ReactNode } from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import {
  AHEAD,
  ANA,
  apiError,
  GONE,
  getPath,
  MARCO,
  makeTimeOff,
  never,
  renderApp,
  respond,
  RITA,
} from "@/tests/pages/time-off/time-off-harness";

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 800 };
const MAX_CONTENT_WIDTH = 880;

const network = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get, post: network.post },
}));

// The bootstrap refresh is the auth flow's business; tests set the session.
vi.mock("@/components/auth/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

const START_URL = window.location.href;

const details = () => page.getByRole("dialog");
const section = (title: string) => page.getByRole("region", { name: title });

const WAITING_LATER = makeTimeOff({ start_date: "2031-11-03", end_date: "2031-11-03", reason: null });
const WAITING = makeTimeOff({ clashing_bookings_count: 2 });
const COMING = makeTimeOff({ status: "approved", start_date: "2031-12-01", end_date: "2031-12-01", reason: "Dentist" });
const DECLINED = makeTimeOff({ status: "rejected", start_date: "2031-11-20", end_date: "2031-11-21" });
const EXPIRED = makeTimeOff({ status: "expired", start_date: GONE, end_date: GONE, reason: null });
const OVER = makeTimeOff({ status: "approved", start_date: "2021-03-01", end_date: "2021-03-02", reason: null });
const SOMEONE_ELSES = makeTimeOff({ staff: ANA });

const MINE = [WAITING_LATER, WAITING, COMING, DECLINED, EXPIRED, OVER];

function getRowTexts(title: string): string[] {
  return section(title)
    .getByRole("listitem")
    .elements()
    .map((row) => row.textContent ?? "");
}

beforeEach(async () => {
  await page.viewport(DESKTOP.width, DESKTOP.height);
  network.get.mockReset();
  network.post.mockReset();
  respond(network.get, { timeOff: [...MINE, SOMEONE_ELSES], viewer: MARCO });
});

afterAll(() => {
  window.history.replaceState(null, "", START_URL);
});

describe("Own time off for a Tutor", () => {
  it("titles the page and offers Request time off", async () => {
    await renderApp("/time-off", MARCO);
    await expect.element(page.getByRole("heading", { level: 1, name: "Time off" })).toBeVisible();
    await expect
      .element(page.getByText("Times you can’t be booked. An Admin approves each request."))
      .toBeVisible();
    await expect.element(page.getByRole("button", { name: "Request time off" })).toHaveTextContent("Request time off");
  });

  it("groups the requests into sections with hints, in order", async () => {
    await renderApp("/time-off", MARCO);
    await expect.element(section("Waiting for an Admin")).toBeVisible();
    const titles = page
      .getByRole("heading", { level: 2 })
      .elements()
      .map((heading) => heading.textContent);
    expect(titles).toEqual(["Waiting for an Admin", "Coming up", "Declined or cancelled", "History"]);
    await expect
      .element(section("Waiting for an Admin").getByText("You can still be booked in these times until an Admin approves."))
      .toBeVisible();
    await expect.element(section("Coming up").getByText("Approved. You can’t be booked in these times.")).toBeVisible();
    await expect
      .element(section("Declined or cancelled").getByText("These won’t take effect. Request again if you still need the time."))
      .toBeVisible();
    await expect.element(section("History").getByText("Over or expired.")).toBeVisible();
  });

  it("shows each row's dates, length and reason, clashes and status", async () => {
    await renderApp("/time-off", MARCO);
    await expect.element(section("Waiting for an Admin")).toBeVisible();
    expect(getRowTexts("Waiting for an Admin")).toEqual([
      "Mon, Oct 20 – Wed, Oct 223 days · Family trip2 sessions in these datesPendingPending",
      "Mon, Nov 31 dayPendingPending",
    ]);
    expect(getRowTexts("Coming up")).toEqual(["Mon, Dec 11 day · DentistApprovedApproved"]);
    expect(getRowTexts("History")).toEqual([
      "Mon, Mar 1 – Tue, Mar 22 daysApprovedApproved",
      "Mon, Jan 61 dayExpiredExpired",
    ]);
  });

  it("hides empty sections", async () => {
    respond(network.get, { timeOff: [WAITING], viewer: MARCO });
    await renderApp("/time-off", MARCO);
    await expect.element(section("Waiting for an Admin")).toBeVisible();
    expect(page.getByRole("heading", { level: 2 }).elements()).toHaveLength(1);
  });

  it("reads only their own list, whole", async () => {
    await renderApp("/time-off", MARCO);
    await expect.element(section("Waiting for an Admin")).toBeVisible();
    const urls = network.get.mock.calls.map(([url]) => url);
    expect(urls).toContain(`/api/users/${MARCO.id}/exceptions`);
    expect(urls).not.toContain("/api/exceptions");
  });

  it("says there is no time off yet, title only", async () => {
    respond(network.get, { timeOff: [], viewer: MARCO });
    await renderApp("/time-off", MARCO);
    const heading = page.getByRole("heading", { name: "No time off yet" });
    await expect.element(heading).toBeVisible();
    expect(heading.element().parentElement?.querySelectorAll("p, button")).toHaveLength(0);
  });

  it("shows a list skeleton while loading", async () => {
    respond(network.get, { viewer: MARCO, list: never });
    await renderApp("/time-off", MARCO);
    await expect.element(page.getByRole("status", { name: "Loading your time off" })).toBeVisible();
  });

  it("offers Try again when the list fails", async () => {
    let calls = 0;
    respond(network.get, {
      viewer: MARCO,
      list: async () => {
        calls += 1;
        if (calls === 1) throw apiError(500);
        return { items: MINE, total: MINE.length, page: 1, page_size: 100 };
      },
    });
    await renderApp("/time-off", MARCO);
    await expect.element(page.getByRole("heading", { name: "Couldn’t load your time off" })).toBeVisible();
    await expect.element(page.getByText("Check your connection and try again.")).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect.element(section("Waiting for an Admin")).toBeVisible();
  });

  it("caps the content at 880px", async () => {
    await renderApp("/time-off", MARCO);
    await expect.element(section("Waiting for an Admin")).toBeVisible();
    expect(section("Waiting for an Admin").element().getBoundingClientRect().width).toBeLessThanOrEqual(
      MAX_CONTENT_WIDTH,
    );
  });

  it("opens a row's details and closes back to the list", async () => {
    await renderApp("/time-off", MARCO);
    await section("Coming up").getByRole("button").click();
    await expect.element(details()).toHaveAccessibleName("Time off for Marco Bell");
    expect(getPath()).toBe(`/time-off/${COMING.id}`);
    await details().getByRole("button", { name: "Close" }).click();
    await expect.poll(getPath).toBe("/time-off");
  });

  it("opens a deep link's details", async () => {
    await renderApp(`/time-off/${DECLINED.id}`, MARCO);
    await expect.element(details()).toHaveAccessibleName("Time off for Marco Bell");
    await details().getByRole("button", { name: "Close" }).click();
    await expect.poll(getPath).toBe("/time-off");
    await expect
      .element(page.getByRole("heading", { level: 1, name: "Time off" }))
      .toHaveFocus();
  });

  it("opens a new request once sent", async () => {
    const created = makeTimeOff({ start_date: AHEAD, end_date: AHEAD });
    network.post.mockImplementation(async () => {
      respond(network.get, { timeOff: [...MINE, created], viewer: MARCO });
      return { status: 201, data: created };
    });
    await renderApp("/time-off", MARCO);
    await page.getByRole("button", { name: "Request time off" }).click();
    await page.getByLabelText("First day").fill(AHEAD);
    await page.getByRole("button", { name: "Send request" }).click();
    await expect.poll(getPath).toBe(`/time-off/${created.id}`);
    await expect.element(details()).toHaveAccessibleName("Time off for Marco Bell");
    expect(network.post).toHaveBeenCalledWith(`/api/users/${MARCO.id}/exceptions`, expect.anything());
  });
});

describe("Own time off at 390", () => {
  it("puts the badge under the dates", async () => {
    await page.viewport(PHONE.width, PHONE.height);
    await renderApp("/time-off", MARCO);
    await expect.element(section("Coming up")).toBeVisible();
    const row = section("Coming up").getByRole("listitem").element();
    const dates = row.querySelector("[data-part='dates']");
    const below = row.querySelector<HTMLElement>("[data-part='badge-below']");
    const trailing = row.querySelector<HTMLElement>("[data-part='badge-trailing']");
    expect(below?.offsetParent).not.toBeNull();
    expect(trailing?.offsetParent).toBeNull();
    expect(below!.getBoundingClientRect().top).toBeGreaterThan(dates!.getBoundingClientRect().top);
    await expect.element(page.getByRole("button", { name: "Request time off" })).toBeVisible();
  });
});

describe("Own time off for a Manager", () => {
  beforeEach(() => {
    respond(network.get, { timeOff: [makeTimeOff({ staff: ANA }), SOMEONE_ELSES], viewer: ANA });
  });

  it("titles the page Your time off and shows only their own list, no queue", async () => {
    await renderApp("/time-off", ANA);
    await expect.element(page.getByRole("heading", { level: 1, name: "Your time off" })).toBeVisible();
    await expect.element(section("Waiting for an Admin")).toBeVisible();
    expect(page.getByRole("navigation", { name: "Time off sections" }).elements()).toHaveLength(0);
    expect(page.getByRole("table").elements()).toHaveLength(0);
    const urls = network.get.mock.calls.map(([url]) => url);
    expect(urls).not.toContain("/api/exceptions");
  });

  it("opens a deep link's details", async () => {
    const own = makeTimeOff({ staff: ANA, status: "approved" });
    respond(network.get, { timeOff: [own], viewer: ANA });
    await renderApp(`/time-off/${own.id}`, ANA);
    await expect.element(details()).toBeVisible();
    await expect.element(details().getByText("Cancel time off")).toBeVisible();
  });
});

describe("Developer", () => {
  it("gets the Admin queue", async () => {
    respond(network.get, { timeOff: [WAITING], viewer: RITA });
    await renderApp("/time-off", RITA, "developer");
    await expect.element(page.getByRole("navigation", { name: "Time off sections" })).toBeVisible();
  });
});
