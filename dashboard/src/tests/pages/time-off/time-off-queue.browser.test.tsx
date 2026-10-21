import type { ReactNode } from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { getTodayKey } from "@/components/kit/format";
import { TIME_OFF_KEY } from "@/lib/queries/time-off";
import {
  AHEAD,
  ANA,
  apiError,
  GONE,
  getListReads,
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
const RENDER_SETTLE_MS = 100;
// Room for a short reason ("Family trip") in full.
const MIN_REASON_WIDTH = 150;
const WHO_SHARE_MAX = 0.32;
// Wide enough for the wide-only columns beside the sidebar.
const WIDE = { width: 1440, height: 800 };

const network = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get, post: network.post, patch: network.patch },
}));

// The bootstrap refresh is the auth flow's business; tests set the session.
vi.mock("@/components/auth/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

const START_URL = window.location.href;

const tabs = () => page.getByRole("navigation", { name: "Time off sections" });
const table = (tab: string) => page.getByRole("table", { name: `Time off, ${tab}` });
const phoneList = (tab: string) => page.getByRole("list", { name: `Time off, ${tab}` });
const search = () => page.getByRole("searchbox", { name: "Search time off by name" });
const pager = () => page.getByRole("navigation", { name: "Time off pages" });
const details = () => page.getByRole("dialog");

function getNames(tab: string): string[] {
  return table(tab)
    .getByRole("row")
    .elements()
    .slice(1)
    .map((row) => (row.querySelector("button")?.getAttribute("aria-label") ?? "").split(",")[0].replace("Open ", ""));
}

// Behind an open overlay the list is inert, so roles can't reach it.
function getCaptionBehind(): string | null | undefined {
  return document.querySelector("main table caption")?.textContent;
}

async function openTab(name: RegExp): Promise<void> {
  await tabs().getByRole("button", { name }).click();
}

async function pickRole(label: string): Promise<void> {
  await page.getByRole("button", { name: "Role" }).click();
  await page.getByRole("checkbox", { name: label }).click();
  await userEvent.keyboard("{Escape}");
}

function getRowTexts(tab: string): string[] {
  return table(tab)
    .getByRole("row")
    .elements()
    .slice(1)
    .map((row) => row.textContent ?? "");
}

const MARCO_PENDING = makeTimeOff({
  staff: MARCO,
  created_at: "2031-10-14T19:10:00Z",
  clashing_bookings_count: 2,
});
const ANA_PENDING = makeTimeOff({
  staff: ANA,
  start_date: "2031-11-03",
  end_date: "2031-11-03",
  start_time: "13:00:00",
  end_time: "17:00:00",
  reason: null,
  created_at: "2031-10-12T13:00:00Z",
});
const MARCO_APPROVED = makeTimeOff({
  staff: MARCO,
  status: "approved",
  start_date: "2031-12-01",
  end_date: "2031-12-02",
  decided_by: { id: RITA.id, name: RITA.name },
  decided_at: "2031-10-15T12:00:00Z",
});
const RITA_APPROVED_SOONER = makeTimeOff({
  staff: RITA,
  status: "approved",
  start_date: "2031-11-10",
  end_date: "2031-11-10",
  reason: "Dentist",
});
const MARCO_DECLINED = makeTimeOff({ staff: MARCO, status: "rejected", start_date: "2031-11-20", end_date: "2031-11-21" });
const ANA_CANCELLED = makeTimeOff({ staff: ANA, status: "cancelled", start_date: "2031-11-05", end_date: "2031-11-05" });
const MARCO_EXPIRED = makeTimeOff({ staff: MARCO, status: "expired", start_date: GONE, end_date: GONE });
const ANA_ENDED = makeTimeOff({ staff: ANA, status: "approved", start_date: "2021-03-01", end_date: "2021-03-02" });
const DECLINED_ENDED = makeTimeOff({ staff: MARCO, status: "rejected", start_date: "2020-06-01", end_date: "2020-06-01" });

const ALL = [
  MARCO_PENDING,
  ANA_PENDING,
  MARCO_APPROVED,
  RITA_APPROVED_SOONER,
  MARCO_DECLINED,
  ANA_CANCELLED,
  MARCO_EXPIRED,
  ANA_ENDED,
  DECLINED_ENDED,
];

beforeEach(async () => {
  await page.viewport(DESKTOP.width, DESKTOP.height);
  network.get.mockReset();
  network.post.mockReset();
  network.patch.mockReset();
  network.patch.mockImplementation(never);
  respond(network.get, { timeOff: ALL });
});

afterAll(() => {
  window.history.replaceState(null, "", START_URL);
});

describe("Admin queue at 1280", () => {
  it("lists pending requests oldest asked first, with the Pending count", async () => {
    await renderApp("/time-off");
    await expect.element(page.getByRole("heading", { level: 1, name: "Time off" })).toBeVisible();
    await expect
      .element(page.getByText("Only Admins approve or decline. Time off you add takes effect straight away."))
      .toBeVisible();
    await expect.element(tabs().getByRole("button", { name: "Pending 2" })).toBeVisible();
    const headers = table("Pending")
      .getByRole("columnheader")
      .elements()
      .map((cell) => cell.textContent);
    expect(headers).toEqual(["Who", "When", "In these dates", "Asked", "Open"]);
    await expect.element(table("Pending").getByText("Oct 14, 3:10 PM")).toBeVisible();
    expect(getRowTexts("Pending")).toEqual([
      "ABAna BrooksManagerMon, Nov 3 · 1:00 PM – 5:00 PM4 hoursNone givenNoneOct 12, 9:00 AM",
      "MBMarco BellTutorMon, Oct 20 – Wed, Oct 223 daysFamily trip2 BookingsOct 14, 3:10 PM",
    ]);
  });

  it("clips a long reason so Asked and the chevrons stay in view", async () => {
    await page.viewport(WIDE.width, WIDE.height);
    const longReason = "A very long reason about a family wedding overseas ".repeat(3).slice(0, 120);
    const longName = { ...MARCO, name: "Maximiliana Wolfeschlegelstein-Hausenberger" };
    respond(network.get, { timeOff: [makeTimeOff({ reason: longReason, staff: longName })] });
    await renderApp("/time-off");
    await expect.element(table("Pending").getByText(longReason)).toBeInTheDocument();
    const tableBox = table("Pending").element().getBoundingClientRect();
    const card = table("Pending").element().parentElement!.getBoundingClientRect();
    expect(tableBox.width).toBeLessThanOrEqual(card.width);
    const asked = table("Pending").getByRole("columnheader", { name: "Asked" }).element().getBoundingClientRect();
    expect(asked.right).toBeLessThanOrEqual(card.right);
    const chevron = table("Pending").getByRole("row").nth(1).element().querySelector("td:last-child svg")!;
    expect(chevron.getBoundingClientRect().right).toBeLessThanOrEqual(card.right);    const cells = table("Pending").getByRole("row").nth(1).element().querySelectorAll("td");
    const [who, , reason] = [...cells];
    expect(reason.clientWidth).toBeGreaterThanOrEqual(MIN_REASON_WIDTH);
    // Who keeps its 30%, the long name truncated.
    expect(who.getBoundingClientRect().width).toBeLessThanOrEqual(tableBox.width * WHO_SHARE_MAX);
  });

  it("adds Reason when there is room", async () => {
    await page.viewport(WIDE.width, WIDE.height);
    await renderApp("/time-off");
    await expect.element(table("Pending")).toBeVisible();
    const headers = table("Pending")
      .getByRole("columnheader")
      .elements()
      .map((cell) => cell.textContent);
    expect(headers).toEqual(["Who", "When", "Reason", "In these dates", "Asked", "Open"]);
    await expect.element(table("Pending").getByText("None given")).toBeVisible();
    await expect.element(table("Pending").getByText("Oct 14, 3:10 PM")).toBeVisible();
  });
});

describe("Admin queue tabs", () => {
  it("lists approved time off ahead soonest first, with its status", async () => {
    await renderApp("/time-off");
    await openTab(/^Upcoming/);
    await expect.element(table("Upcoming")).toBeVisible();
    expect(getNames("Upcoming")).toEqual(["Rita Souza", "Marco Bell"]);
    await expect.element(table("Upcoming").getByText("Approved").first()).toBeVisible();
    expect(getPath()).toBe("/time-off?tab=upcoming");
  });

  it("lists declined and cancelled time off ahead soonest first, muting cancelled", async () => {
    await renderApp("/time-off");
    await openTab(/^Declined & cancelled/);
    await expect.element(table("Declined & cancelled")).toBeVisible();
    expect(getNames("Declined & cancelled")).toEqual(["Ana Brooks", "Marco Bell"]);
    const [cancelled, declined] = table("Declined & cancelled").getByRole("row").elements().slice(1);
    expect(cancelled.className).toContain("text-(--tl-muted)");
    expect(declined.className).not.toContain("text-(--tl-muted)");
    expect(cancelled.textContent).toContain("—");
  });

  it("lists everything ended in Past, most recent first, Expired included and muted", async () => {
    await renderApp("/time-off");
    await openTab(/^Past/);
    await expect.element(table("Past")).toBeVisible();
    expect(getNames("Past")).toEqual(["Ana Brooks", "Marco Bell", "Marco Bell"]);
    const rows = table("Past").getByRole("row").elements().slice(1);
    expect(rows.map((row) => row.textContent?.match(/Approved|Declined|Expired/)?.[0])).toEqual([
      "Approved",
      "Declined",
      "Expired",
    ]);
    expect(rows[2].className).toContain("text-(--tl-muted)");
  });

  it("reads not-ended rows for the live tabs and started rows only for Past", async () => {
    await renderApp("/time-off");
    await expect.element(table("Pending")).toBeVisible();
    const today = getTodayKey();
    expect(getListReads(network.get)).toEqual([
      { status: ["pending", "approved", "rejected", "cancelled"], from: today, page: 1, page_size: 100 },
    ]);
    await openTab(/^Past/);
    await expect.element(table("Past")).toBeVisible();
    expect(getListReads(network.get).at(-1)).toEqual({ to: today, page: 1, page_size: 100 });
  });

  it("places a part-day window that ended earlier today in Past", async () => {
    const endedToday = makeTimeOff({
      status: "approved",
      start_date: getTodayKey(),
      end_date: getTodayKey(),
      start_time: "00:00:00",
      end_time: "00:00:01",
    });
    respond(network.get, { timeOff: [endedToday] });
    await renderApp("/time-off?tab=upcoming");
    await expect.element(page.getByText("No time off coming up")).toBeVisible();
    await openTab(/^Past/);
    await expect.element(table("Past")).toBeVisible();
    expect(getNames("Past")).toEqual(["Marco Bell"]);
  });

  it("keeps the search and filter on a tab change", async () => {
    await renderApp("/time-off?q=marco&role=tutor&page=2");
    await openTab(/^Upcoming/);
    await expect.element(table("Upcoming")).toBeVisible();
    expect(getPath()).toBe("/time-off?q=marco&role=tutor&tab=upcoming");
    expect(getNames("Upcoming")).toEqual(["Marco Bell"]);
    await expect.element(search()).toHaveValue("marco");
  });
});

describe("Admin queue paging", () => {
  const MANY = Array.from({ length: 30 }, (_, index) =>
    makeTimeOff({ created_at: `2031-10-${String(index + 1).padStart(2, "0")}T12:00:00Z` }),
  );

  it("shows 25 a page and moves with the Pager", async () => {
    respond(network.get, { timeOff: MANY });
    await renderApp("/time-off");
    await expect.element(table("Pending")).toBeVisible();
    expect(getNames("Pending")).toHaveLength(25);
    await expect.element(tabs().getByRole("button", { name: "Pending 30" })).toBeVisible();
    await expect.element(pager().getByText("1–25 of 30", { exact: true })).toBeVisible();
    await pager().getByRole("button", { name: "Next" }).click();
    await expect.poll(() => getNames("Pending")).toHaveLength(5);
    expect(getPath()).toBe("/time-off?page=2");
    await expect.element(pager().getByText("26–30 of 30", { exact: true })).toBeVisible();
  });

  it("shows the last page for a page past the end", async () => {
    respond(network.get, { timeOff: MANY });
    await renderApp("/time-off?page=9");
    await expect.element(table("Pending")).toBeVisible();
    expect(getNames("Pending")).toHaveLength(5);
  });

  it("starts again from page 1 on a new tab", async () => {
    respond(network.get, { timeOff: MANY });
    await renderApp("/time-off?page=2");
    await openTab(/^Upcoming/);
    expect(getPath()).toBe("/time-off?tab=upcoming");
  });

  it("uses the phone form of the Pager at 390", async () => {
    await page.viewport(PHONE.width, PHONE.height);
    respond(network.get, { timeOff: MANY });
    await renderApp("/time-off");
    await expect.element(pager()).toHaveTextContent(/^Page 1 of 2/);
    await pager().getByRole("button", { name: "Next page" }).click();
    await expect.element(pager()).toHaveTextContent(/^Page 2 of 2/);
  });
});

describe("Admin queue search and filter", () => {
  it("searches by name after a pause in typing, from page 1", async () => {
    await renderApp("/time-off");
    await expect.element(table("Pending")).toBeVisible();
    await search().fill("ana");
    await expect.poll(() => getNames("Pending")).toEqual(["Ana Brooks"]);
    expect(getPath()).toBe("/time-off?q=ana");
  });

  it("filters by role and clears it with Clear all", async () => {
    await renderApp("/time-off");
    await expect.element(table("Pending")).toBeVisible();
    await pickRole("Tutors");
    await expect.poll(() => getNames("Pending")).toEqual(["Marco Bell"]);
    expect(getPath()).toBe("/time-off?role=tutor");
    await page.getByRole("button", { name: "Clear all" }).click();
    await expect.poll(() => getNames("Pending")).toEqual(["Ana Brooks", "Marco Bell"]);
    expect(getPath()).toBe("/time-off");
  });

  it("says when nothing matches, without a button", async () => {
    await renderApp("/time-off?q=zed");
    await expect.element(page.getByRole("heading", { name: "No time off matches" })).toBeVisible();
    await expect.element(page.getByText("Try another name, or clear the filters.")).toBeVisible();
    const card = page.getByRole("heading", { name: "No time off matches" }).element().parentElement;
    expect(card?.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("Admin queue states", () => {
  it.each([
    ["pending", "Nothing to review"],
    ["upcoming", "No time off coming up"],
    ["declined-cancelled", "Nothing declined or cancelled ahead"],
    ["past", "No past time off"],
  ])("says %s is empty, title only", async (tab, title) => {
    respond(network.get, { timeOff: [] });
    await renderApp(tab === "pending" ? "/time-off" : `/time-off?tab=${tab}`);
    const heading = page.getByRole("heading", { name: title });
    await expect.element(heading).toBeVisible();
    const card = heading.element().parentElement;
    expect(card?.querySelectorAll("p, button")).toHaveLength(0);
  });

  it("shows a table skeleton and no Pending count while loading, the toolbar working", async () => {
    respond(network.get, { list: never });
    await renderApp("/time-off");
    await expect.element(page.getByRole("status", { name: "Loading time off" })).toBeVisible();
    await expect
      .element(tabs().getByRole("button", { name: "Pending", exact: true }))
      .toBeVisible();
    await expect.element(search()).toBeEnabled();
  });

  it("offers Try again when the list fails", async () => {
    let calls = 0;
    respond(network.get, {
      timeOff: ALL,
      list: async () => {
        calls += 1;
        if (calls === 1) throw apiError(500);
        return { items: ALL, total: ALL.length, page: 1, page_size: 100 };
      },
    });
    await renderApp("/time-off");
    await expect.element(page.getByRole("heading", { name: "Couldn’t load time off" })).toBeVisible();
    await expect.element(page.getByText("Check your connection and try again.")).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect.element(table("Pending")).toBeVisible();
  });
});

describe("Admin queue at 390", () => {
  beforeEach(async () => {
    await page.viewport(PHONE.width, PHONE.height);
  });

  it("shows phone rows with the clash count, else the reason, and no badge on Pending", async () => {
    await renderApp("/time-off");
    await expect.element(phoneList("Pending")).toBeVisible();
    const rows = phoneList("Pending").getByRole("listitem").elements().map((row) => row.textContent);
    expect(rows).toEqual([
      "ABAna BrooksMon, Nov 3 · 1:00 PM – 5:00 PM4 hours",
      "MBMarco BellMon, Oct 20 – Wed, Oct 222 Bookings in these dates",
    ]);
    await expect.element(page.getByRole("button", { name: "Add time off" })).toBeVisible();
  });

  it("puts the status badge on phone rows outside Pending", async () => {
    await renderApp("/time-off?tab=upcoming");
    await expect.element(phoneList("Upcoming")).toBeVisible();
    const rows = phoneList("Upcoming").getByRole("listitem").elements().map((row) => row.textContent);
    expect(rows).toEqual([
      "RSRita SouzaMon, Nov 10DentistApproved",
      "MBMarco BellMon, Dec 1 – Tue, Dec 2Family tripApproved",
    ]);
  });
});

describe("Admin details over the queue", () => {
  it("opens a row's details and closes back to the same list", async () => {
    await renderApp("/time-off?tab=upcoming&role=admin");
    await table("Upcoming").getByRole("button", { name: /^Open Rita Souza/ }).click();
    await expect.element(details()).toHaveAccessibleName("Time off for Rita Souza");
    expect(getPath()).toBe(`/time-off/${RITA_APPROVED_SOONER.id}?tab=upcoming&role=admin`);
    await details().getByRole("button", { name: "Close" }).click();
    await expect.poll(getPath).toBe("/time-off?tab=upcoming&role=admin");
    await expect.element(details()).not.toBeInTheDocument();
  });

  it("opens a deep link's details over the list, closing to the list with focus on the title", async () => {
    await renderApp(`/time-off/${MARCO_DECLINED.id}?tab=declined-cancelled`);
    await expect.element(details()).toHaveAccessibleName("Time off for Marco Bell");
    await expect.poll(getCaptionBehind).toBe("Time off, Declined & cancelled");
    await details().getByRole("button", { name: "Close" }).click();
    await expect.poll(getPath).toBe("/time-off?tab=declined-cancelled");
    await expect
      .element(page.getByRole("heading", { level: 1, name: "Time off" }))
      .toHaveFocus();
  });

  it("shows not-found inside the overlay for an unreadable id, the list behind", async () => {
    await renderApp("/time-off/to-missing");
    await expect.element(page.getByText("Couldn’t find this time off")).toBeVisible();
    await expect.poll(getCaptionBehind).toBe("Time off, Pending");
  });

  it("keeps a decided row out of Pending while its Undo waits, even when the list reads again", async () => {
    const client = await renderApp(`/time-off/${MARCO_PENDING.id}`);
    await details().getByRole("button", { name: "Approve" }).click();
    await expect.element(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await details().getByRole("button", { name: "Close" }).click();
    await expect.element(tabs().getByRole("button", { name: "Pending 1" })).toBeVisible();
    const reads = getListReads(network.get).length;
    await client.invalidateQueries({ queryKey: TIME_OFF_KEY });
    await expect.poll(() => getListReads(network.get).length).toBeGreaterThan(reads);
    await expect.poll(() => client.isFetching()).toBe(0);
    // The cache has the fresh read; give React its render before looking.
    await new Promise((resolve) => setTimeout(resolve, RENDER_SETTLE_MS));
    await expect.element(tabs().getByRole("button", { name: "Pending 1" })).toBeVisible();
    expect(getNames("Pending")).toEqual(["Ana Brooks"]);
  });
});

describe("Add time off", () => {
  it("opens the new item in the tab it belongs in", async () => {
    const created = makeTimeOff({
      staff: ANA,
      status: "approved",
      start_date: AHEAD,
      end_date: AHEAD,
      entered_by: { id: RITA.id, name: RITA.name },
      decided_by: { id: RITA.id, name: RITA.name },
    });
    network.post.mockImplementation(async () => {
      respond(network.get, { timeOff: [...ALL, created] });
      return { status: 201, data: created };
    });
    await renderApp("/time-off");
    await page.getByRole("button", { name: "Add time off" }).click();
    await page.getByRole("combobox", { name: "For (required)" }).click();
    await page.getByRole("option", { name: /^Ana Brooks/ }).click();
    await page.getByLabelText("First day").fill(AHEAD);
    await page.getByRole("dialog").getByRole("button", { name: "Add time off", exact: true }).click();
    await expect.poll(getPath).toBe(`/time-off/${created.id}?tab=upcoming`);
    await expect.element(details()).toHaveAccessibleName("Time off for Ana Brooks");
    await details().getByRole("button", { name: "Close" }).click();
    await expect.poll(getPath).toBe("/time-off?tab=upcoming");
    await expect.element(table("Upcoming").getByText("Ana Brooks")).toBeVisible();
  });
});
