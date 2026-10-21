import type { ReactNode } from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  ANA,
  DAN,
  getListReads,
  getPath,
  never,
  renderApp,
  respond,
} from "@/tests/pages/staff/staff-harness";

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 800 };
const NARROW_PHONE = { width: 320, height: 640 };
// Past the search box's typing pause.
const SEARCH_PAUSE_MS = 300;

const network = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get },
}));

// The bootstrap refresh is the auth flow's business; tests set the session.
vi.mock("@/components/auth/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

const START_URL = window.location.href;

const table = () => page.getByRole("table", { name: "Staff" });
const phoneList = () => page.getByRole("list", { name: "Staff" });
const listTabs = () => page.getByRole("navigation", { name: "Staff lists" });
const search = () => page.getByRole("searchbox", { name: "Search Staff" });

function getRowTexts(): string[] {
  return table()
    .getByRole("row")
    .elements()
    .slice(1)
    .map((row) => row.textContent ?? "");
}

beforeEach(async () => {
  await page.viewport(DESKTOP.width, DESKTOP.height);
  network.get.mockReset();
  respond(network.get);
});

afterAll(() => {
  window.history.replaceState(null, "", START_URL);
});

describe("Staff list at 1280", () => {
  it("shows Name, Role, Subjects and Sign-in state for each Staff member", async () => {
    await renderApp("/staff");
    await expect.element(table()).toBeVisible();
    const headers = table()
      .getByRole("columnheader")
      .elements()
      .map((cell) => cell.textContent);
    expect(headers).toEqual(["Name", "Role", "Subjects", "Sign-in state", "Open"]);
    expect(getRowTexts()).toEqual([
      "ABAna BrooksTime off pendingTutorMaths, ReadingActive",
      "RSRita SouzaAdmin—Active",
      "DMDan MossAdmin—Invited",
      "MLMo LimaManagerNone yetNot invited",
    ]);
  });

  it("gives Admins the description and a labelled Add staff", async () => {
    await renderApp("/staff");
    await expect
      .element(
        page.getByText("Everyone a Booking can be with: Tutors, Managers and Admins."),
      )
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Add staff" }))
      .toHaveTextContent("Add staff");
  });

  it("tells Managers it's view only, with no Add staff", async () => {
    await renderApp("/staff", "manager");
    await expect
      .element(page.getByText("View only. Admins add and change Staff."))
      .toBeVisible();
    await expect.element(table()).toBeVisible();
    expect(page.getByRole("button", { name: "Add staff" }).elements()).toHaveLength(0);
  });

  it("counts each tab once loaded", async () => {
    await renderApp("/staff");
    const tabs = listTabs();
    await expect.element(tabs.getByRole("button", { name: "Staff 4" })).toBeVisible();
    await expect.element(tabs.getByRole("button", { name: "Archived 1" })).toBeVisible();
  });

  it("hides the counts while they load", async () => {
    respond(network.get, { list: never });
    network.get.mockImplementation(never);
    await renderApp("/staff");
    await expect
      .element(page.getByRole("status", { name: "Loading Staff" }))
      .toBeVisible();
    await expect
      .element(listTabs().getByRole("button", { name: "Staff", exact: true }))
      .toBeVisible();
    await expect.element(search()).toBeEnabled();
  });

  it("mutes archived rows on the Archived tab", async () => {
    await renderApp("/staff");
    await listTabs().getByRole("button", { name: /Archived/ }).click();
    await expect.element(table().getByText("Zoe Park")).toBeVisible();
    const row = table().getByRole("row").nth(1).element();
    expect(row.className).toContain("text-(--tl-muted)");
    await expect.element(table().getByText("Archived", { exact: true })).toBeVisible();
    expect(getPath()).toBe("/staff?list=archived");
  });

  it("searches by name on the server", async () => {
    await renderApp("/staff");
    await expect.element(table()).toBeVisible();
    await search().fill("an");
    await expect.poll(getRowTexts).toHaveLength(2);
    const last = getListReads(network.get).at(-1);
    expect(last?.get("q")).toBe("an");
    expect(last?.get("archived")).toBe("false");
    expect(last?.get("page_size")).toBe("100");
  });

  it("waits for a pause in typing before searching", async () => {
    await renderApp("/staff");
    await expect.element(table()).toBeVisible();
    await userEvent.type(search(), "ana");
    await expect.poll(() => getListReads(network.get).at(-1)?.get("q")).toBe("ana");
    const searched = getListReads(network.get)
      .map((params) => params.get("q"))
      .filter((q) => q !== null);
    expect(searched).toEqual(["ana"]);
    expect(getPath()).toBe("/staff?q=ana");
  });

  it("keeps the caret where it is when editing mid-text", async () => {
    await renderApp("/staff");
    await search().fill("Ana Brooks");
    await expect.poll(getPath).toBe("/staff?q=Ana+Brooks");
    const input = search().element() as HTMLInputElement;
    input.setSelectionRange(3, 3);
    await userEvent.keyboard("xy");
    await expect.element(search()).toHaveValue("Anaxy Brooks");
    expect(input.selectionStart).toBe(5);
    await expect.poll(getPath).toBe("/staff?q=Anaxy+Brooks");
    expect(input.selectionStart).toBe(5);
  });

  it("keeps a filter picked while the search is still waiting", async () => {
    await renderApp("/staff");
    await expect.element(table()).toBeVisible();
    // Hold the search's pause open so the filter lands inside it.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await userEvent.type(search(), "ana");
      await page.getByRole("button", { name: "Role" }).click();
      await page.getByRole("checkbox", { name: "Tutors" }).click();
      await page.getByRole("button", { name: "Done" }).click();
      await expect.poll(getPath).toBe("/staff?role=tutor");
      await vi.advanceTimersByTimeAsync(SEARCH_PAUSE_MS);
    } finally {
      vi.useRealTimers();
    }
    await expect.poll(getPath).toBe("/staff?role=tutor&q=ana");
    await expect.poll(() => getListReads(network.get).at(-1)?.toString()).toBe(
      "archived=false&page_size=100&role=tutor&q=ana",
    );
  });

  it("stays on details opened while the search is still waiting, then searches on close", async () => {
    await renderApp("/staff");
    await expect.element(table()).toBeVisible();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await userEvent.type(search(), "ana");
      await page.getByRole("button", { name: "Open Ana Brooks" }).click();
      await expect.element(page.getByRole("dialog")).toBeVisible();
      await vi.advanceTimersByTimeAsync(SEARCH_PAUSE_MS);
    } finally {
      vi.useRealTimers();
    }
    await expect.element(page.getByRole("dialog", { name: "Staff: Ana Brooks" })).toBeVisible();
    expect(getPath()).toBe("/staff/u-ana");

    await page.getByRole("button", { name: "Close" }).click();
    await expect.poll(getPath).toBe("/staff?q=ana");
    await expect.element(search()).toHaveValue("ana");
  });

  it("filters by Role and Sign-in state, and Clear all lifts both", async () => {
    await renderApp("/staff");
    await expect.element(table()).toBeVisible();
    await page.getByRole("button", { name: "Role" }).click();
    await page.getByRole("checkbox", { name: "Admins" }).click();
    await page.getByRole("checkbox", { name: "Tutors" }).click();
    await page.getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: "Sign-in state" }).click();
    await page.getByRole("checkbox", { name: "Active" }).click();
    await page.getByRole("button", { name: "Done" }).click();

    await expect.poll(getRowTexts).toHaveLength(2);
    const last = getListReads(network.get).at(-1);
    expect(last?.getAll("role")).toEqual(["admin", "tutor"]);
    expect(last?.getAll("sign_in_state")).toEqual(["active"]);

    await page.getByRole("button", { name: "Clear all" }).click();
    await expect.poll(getRowTexts).toHaveLength(4);
    expect(getPath()).toBe("/staff");
  });

  it("clears search and filters on a tab change", async () => {
    await renderApp("/staff?q=zz&role=tutor");
    await expect.element(search()).toHaveValue("zz");
    await listTabs().getByRole("button", { name: /Archived/ }).click();
    await expect.element(search()).toHaveValue("");
    await expect.element(page.getByRole("button", { name: "Role" })).toHaveTextContent("Role");
    await expect
      .poll(() => getListReads(network.get).at(-1)?.toString())
      .toBe("archived=true&page_size=100");
    expect(getPath()).toBe("/staff?list=archived");
  });

  it("says nothing matches, with no button, when a search finds no one", async () => {
    await renderApp("/staff?q=nobody");
    await expect.element(page.getByRole("heading", { name: "No Staff match" })).toBeVisible();
    await expect
      .element(page.getByText("Try another name, or clear the filters."))
      .toBeVisible();
    expect(page.getByRole("main").getByRole("button", { name: /Clear search/ }).elements()).toHaveLength(1);
  });

  it("says No archived Staff, title only, on an empty Archived tab", async () => {
    respond(network.get, { staff: [ANA] });
    await renderApp("/staff?list=archived");
    const heading = page.getByRole("heading", { name: "No archived Staff" });
    await expect.element(heading).toBeVisible();
    const card = heading.element().parentElement;
    expect(card?.querySelectorAll("p, button")).toHaveLength(0);
  });

  it("offers Try again when the list fails, and loads on retry", async () => {
    let fails = true;
    respond(network.get, {
      list: async () => {
        if (fails) throw new Error("offline");
        return { items: [ANA], total: 1, page: 1, page_size: 100 };
      },
    });
    await renderApp("/staff");
    await expect.element(page.getByRole("heading", { name: "Couldn’t load Staff" })).toBeVisible();
    await expect
      .element(page.getByText("Check your connection and try again."))
      .toBeVisible();
    fails = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect.element(table().getByText("Ana Brooks")).toBeVisible();
  });

  it("closes back to the list's own history entry", async () => {
    // A fresh entry drops forward entries an earlier test's Back left behind.
    window.history.pushState(null, "", "/staff");
    await renderApp("/staff");
    // React Router's entry index: history.length caps at 50 in Chromium, so a
    // long suite run can't see it grow.
    const historyIndex = () => (window.history.state as { idx: number }).idx;
    const before = historyIndex();
    await page.getByRole("button", { name: "Open Ana Brooks" }).click();
    await expect.poll(historyIndex).toBe(before + 1);
    await page.getByRole("button", { name: "Close" }).click();
    await expect.poll(getPath).toBe("/staff");
    // Stepped back rather than pushing a second list entry.
    expect(historyIndex()).toBe(before);
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens a row's details at /staff/:id", async () => {
    await renderApp("/staff");
    await page.getByRole("button", { name: "Open Ana Brooks" }).click();
    expect(getPath()).toBe("/staff/u-ana");
    await expect.element(page.getByRole("dialog", { name: "Staff: Ana Brooks" })).toBeVisible();
  });
});

describe("Staff list at 390", () => {
  beforeEach(async () => {
    await page.viewport(PHONE.width, PHONE.height);
  });

  it("shows tappable rows with role · Subjects, the pending note and the badge", async () => {
    await renderApp("/staff");
    const ana = phoneList().getByRole("button", { name: /Ana Brooks/ });
    await expect.element(ana).toHaveTextContent(
      "ABAna BrooksTutor · Maths, ReadingTime off pendingActive",
    );
    await expect
      .element(phoneList().getByRole("button", { name: /Dan Moss/ }))
      .toHaveTextContent("DMDan MossAdminInvited");
    expect(ana.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(72);
    await expect.element(table()).not.toBeInTheDocument();
  });

  it("makes Add staff a round icon button for Admins", async () => {
    await renderApp("/staff");
    const add = page.getByRole("button", { name: "Add staff" });
    await expect.element(add).toBeVisible();
    await expect.element(add).toHaveTextContent("");
    const box = add.element().getBoundingClientRect();
    expect(box.width).toBe(box.height);
  });

  it("gives Managers no Add staff", async () => {
    await renderApp("/staff", "manager");
    await expect.element(phoneList()).toBeVisible();
    expect(page.getByRole("button", { name: "Add staff" }).elements()).toHaveLength(0);
  });

  it("opens a phone row's details", async () => {
    await renderApp("/staff");
    await phoneList().getByRole("button", { name: /Dan Moss/ }).click();
    expect(getPath()).toBe(`/staff/${DAN.id}`);
  });

  it("never scrolls the page sideways at 320", async () => {
    await page.viewport(NARROW_PHONE.width, NARROW_PHONE.height);
    await renderApp("/staff");
    await expect.element(phoneList()).toBeVisible();
    const scroller = document.querySelector("[data-kit-scroll]");
    expect(scroller?.scrollWidth).toBeLessThanOrEqual(scroller?.clientWidth ?? 0);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(NARROW_PHONE.width);
  });

  it("scrolls the filter pills sideways instead of wrapping", async () => {
    await renderApp("/staff");
    const filters = page.getByRole("group", { name: "Filters" }).element();
    expect(getComputedStyle(filters).overflowX).toBe("auto");
    expect(getComputedStyle(filters).flexWrap).toBe("nowrap");
  });
});

describe("Staff list routes", () => {
  it("keeps Tutors out of Staff", async () => {
    await renderApp("/staff", "tutor");
    await expect.poll(getPath).toBe("/sessions");
  });

  it("marks the Staff nav item current on /staff", async () => {
    await renderApp("/staff");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect
      .element(nav.getByRole("button", { name: "Staff" }))
      .toHaveAttribute("aria-current", "page");
  });

  it.each(["/users", "/tutors"])("sends %s to /staff", async (path) => {
    await renderApp(path);
    await expect.poll(getPath).toBe("/staff");
  });

  it("sends an old Tutor's page to their Staff details", async () => {
    await renderApp("/tutors/t-ana");
    await expect.poll(getPath).toBe("/staff/u-ana");
  });

  it("sends an unreadable Tutor's page to the Staff list", async () => {
    await renderApp("/tutors/t-gone");
    await expect.poll(getPath).toBe("/staff");
  });
});
