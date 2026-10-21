import type { ReactNode } from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  ANA,
  DAN,
  getPath,
  makeStaff,
  MO,
  never,
  notFound,
  renderApp,
  respond,
  RITA,
  VIEWER_ID,
  ZOE,
} from "@/tests/pages/staff/staff-harness";

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 800 };
const SLIDE_OVER_WIDTH = 440;
const DAY_MS = 86_400_000;

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

const details = () => page.getByRole("dialog");
const sections = () =>
  details().getByRole("navigation", { name: "Staff details sections" });

function getTabLabels(): string[] {
  return sections()
    .getByRole("button")
    .elements()
    .map((tab) => tab.textContent ?? "");
}

function getActiveTab(): string | null {
  return sections().element().querySelector("[aria-current=page]")?.textContent ?? null;
}

// "Oct 27" in the business's zone, as the Overview writes it.
function formatShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

beforeEach(async () => {
  await page.viewport(DESKTOP.width, DESKTOP.height);
  network.get.mockReset();
  respond(network.get);
});

afterAll(() => {
  window.history.replaceState(null, "", START_URL);
});

describe("Staff details at 1280", () => {
  it("is a 440px slide-over with the badge, identity and Close", async () => {
    await renderApp("/staff/u-ana");
    const dialog = page.getByRole("dialog", { name: "Staff: Ana Brooks" });
    await expect.element(dialog).toBeVisible();
    await expect.element(dialog.getByText("Active", { exact: true })).toBeVisible();
    await expect.element(dialog.getByRole("heading", { name: "Ana Brooks" })).toBeVisible();
    await expect.element(dialog.getByText("Tutor", { exact: true })).toBeVisible();
    expect(dialog.element().getBoundingClientRect().width).toBe(SLIDE_OVER_WIDTH);
    // The list stays behind the slide-over (inert, so out of the a11y tree).
    expect(document.querySelector("table caption")?.textContent).toBe("Staff");
  });

  it("gives a Tutor or Manager all five tabs, an Admin three", async () => {
    await renderApp("/staff/u-mo");
    await expect.element(sections()).toBeVisible();
    expect(getTabLabels()).toEqual([
      "Overview",
      "Availability",
      "Children",
      "Time off",
      "Bookings",
    ]);
    await page.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Open Dan Moss" }).click();
    await expect.element(details().getByRole("heading", { name: "Dan Moss" })).toBeVisible();
    expect(getTabLabels()).toEqual(["Overview", "Time off", "Bookings"]);
  });

  it("keeps the tab in ?tab= and opens on it", async () => {
    await renderApp("/staff/u-ana?tab=time-off");
    await expect.element(sections()).toBeVisible();
    expect(getActiveTab()).toBe("Time off");
    await sections().getByRole("button", { name: "Bookings" }).click();
    expect(getPath()).toBe("/staff/u-ana?tab=bookings");
    await sections().getByRole("button", { name: "Overview" }).click();
    expect(getPath()).toBe("/staff/u-ana");
  });

  it.each([
    ["an unknown tab", "/staff/u-ana?tab=nope"],
    ["a tab an Admin doesn't have", "/staff/u-dan?tab=availability"],
  ])("falls back to Overview on %s, fixing the URL", async (_, path) => {
    await renderApp(path);
    await expect.element(details().getByText("Email")).toBeVisible();
    expect(getActiveTab()).toBe("Overview");
    await expect.poll(getPath).toBe(path.split("?")[0]);
  });

  it("closes back to the list's tab, search and filters", async () => {
    await renderApp("/staff?list=archived&q=zo");
    await page.getByRole("button", { name: "Open Zoe Park" }).click();
    expect(getPath()).toBe("/staff/u-zoe?list=archived&q=zo");
    await expect
      .element(details().getByText("Archived", { exact: true }).last())
      .toBeVisible();
    await sections().getByRole("button", { name: "Bookings" }).click();
    await page.getByRole("button", { name: "Close" }).click();
    expect(getPath()).toBe("/staff?list=archived&q=zo");
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a skeleton while they load", async () => {
    respond(network.get, { detail: never });
    await renderApp("/staff/u-ana");
    await expect
      .element(page.getByRole("status", { name: "Loading Staff details" }))
      .toBeVisible();
  });

  it("says it can't find someone who isn't there, with Back to Staff", async () => {
    await renderApp("/staff/u-gone");
    await expect
      .element(details().getByRole("heading", { name: "Couldn’t find this Staff member" }))
      .toBeVisible();
    await expect.element(details().getByText("They may have been removed.")).toBeVisible();
    await details().getByRole("button", { name: "Back to Staff" }).click();
    expect(getPath()).toBe("/staff");
  });

  it("treats a malformed id as not found, not a connection error", async () => {
    respond(network.get, {
      detail: async () => {
        throw notFound(400);
      },
    });
    await renderApp("/staff/abc");
    await expect
      .element(details().getByRole("heading", { name: "Couldn’t find this Staff member" }))
      .toBeVisible();
  });

  it("escapes the id in the request path", async () => {
    await renderApp("/staff/a%2Fb");
    await expect.element(details().getByRole("heading", { name: /Couldn’t find/ })).toBeVisible();
    expect(network.get).toHaveBeenCalledWith("/api/staff/a%2Fb");
  });

  it("bleeds the tab row to the panel's edges and shows a deep-linked last tab", async () => {
    await renderApp("/staff/u-ana?tab=bookings");
    await expect.element(sections()).toBeVisible();
    const panel = details().element().getBoundingClientRect();
    const nav = sections().element().getBoundingClientRect();
    expect(nav.width).toBeGreaterThan(panel.width - 4);
    const active = sections().getByRole("button", { name: "Bookings" });
    await expect.poll(() => {
      const box = active.element().getBoundingClientRect();
      return box.left >= nav.left && box.right <= nav.right;
    }).toBe(true);
  });

  it("scrolls a tab reached by keyboard into view", async () => {
    await renderApp("/staff/u-ana");
    await expect.element(sections()).toBeVisible();
    const nav = sections().element().getBoundingClientRect();
    const bookings = sections().getByRole("button", { name: "Bookings" });
    expect(bookings.element().getBoundingClientRect().right).toBeGreaterThan(nav.right);
    (sections().getByRole("button", { name: "Time off" }).element() as HTMLElement).focus();
    await userEvent.tab();
    await expect.element(bookings).toHaveFocus();
    await expect.poll(() => {
      const box = bookings.element().getBoundingClientRect();
      return box.left >= nav.left && box.right <= nav.right;
    }).toBe(true);
  });

  it("fades the tab row's right edge while more tabs sit past it", async () => {
    await renderApp("/staff/u-ana");
    await expect.element(sections()).toBeVisible();
    const getFade = () => getComputedStyle(sections().element()).maskImage;
    await expect.poll(getFade).not.toBe("none");
    (sections().getByRole("button", { name: "Bookings" }).element() as HTMLElement).focus();
    await expect.poll(getFade).toBe("none");
  });

  it("shows no fade when every tab fits", async () => {
    await renderApp(`/staff/${RITA.id}`);
    await expect.element(sections()).toBeVisible();
    expect(getComputedStyle(sections().element()).maskImage).toBe("none");
  });

  it("offers Try again inline when they fail to load", async () => {
    let fails = true;
    respond(network.get, {
      detail: async () => {
        if (fails) throw new Error("offline");
        return ANA;
      },
    });
    await renderApp("/staff/u-ana");
    await expect
      .element(
        details().getByText("Couldn’t load their details. Check your connection and try again."),
      )
      .toBeVisible();
    fails = false;
    await details().getByRole("button", { name: "Try again" }).click();
    await expect.element(details().getByRole("heading", { name: "Ana Brooks" })).toBeVisible();
  });
});

describe("Staff details notices", () => {
  it("tells a Manager a Tutor's details are view only, apart from Children", async () => {
    await renderApp("/staff/u-ana", "manager");
    await expect
      .element(
        details().getByText(
          "View only, apart from their assigned Children. An Admin changes Staff, their teaching and their Time off.",
        ),
      )
      .toBeVisible();
  });

  it("tells a Manager an Admin's details are view only", async () => {
    await renderApp("/staff/u-dan", "manager");
    await expect
      .element(details().getByText("View only. An Admin changes Staff."))
      .toBeVisible();
  });

  it("tells an Admin why another Admin's account is locked", async () => {
    await renderApp("/staff/u-dan");
    await expect
      .element(details().getByText("Only a developer can change another Admin’s account."))
      .toBeVisible();
  });

  it("tells an Admin they can't archive themselves", async () => {
    await renderApp(`/staff/${VIEWER_ID}`);
    await expect.element(details().getByText("You can’t archive yourself.")).toBeVisible();
  });

  it("shows no notice to an Admin on a Tutor", async () => {
    await renderApp("/staff/u-ana");
    await expect.element(details().getByText("Email")).toBeVisible();
    expect(details().getByText(/View only|Only a developer|archive yourself/).elements()).toHaveLength(0);
  });
});

describe("Staff Overview", () => {
  it("lists contact, sign-in, this week, bio and Subjects with their grade", async () => {
    await renderApp("/staff/u-ana");
    const dialog = details();
    await expect.element(dialog.getByText("ana@example.com")).toBeVisible();
    await expect.element(dialog.getByText("+1 (305) 555-0142")).toBeVisible();
    await expect.element(dialog.getByText("Active: has chosen a password")).toBeVisible();
    await expect.element(dialog.getByText("4 Bookings")).toBeVisible();
    await expect.element(dialog.getByText("No bio yet")).toBeVisible();
    await expect.element(dialog.getByRole("heading", { name: "Subjects · 2" })).toBeVisible();
    const subjects = dialog.getByRole("list", { name: "Subjects" });
    await expect.element(subjects).toHaveTextContent("Mathsup to Grade 8Readingup to Kindergarten");
  });

  it("says one Booking, hides a missing phone, and shows no Subjects for an Admin", async () => {
    await renderApp(`/staff/${RITA.id}`);
    const dialog = details();
    await expect.element(dialog.getByText("1 Booking", { exact: true })).toBeVisible();
    expect(dialog.getByText("Phone").elements()).toHaveLength(0);
    expect(dialog.getByText("Bio").elements()).toHaveLength(0);
    expect(dialog.getByText(/Subjects ·/).elements()).toHaveLength(0);
  });

  it("explains an empty Subjects list in a sunk well", async () => {
    await renderApp(`/staff/${MO.id}`);
    await expect.element(details().getByRole("heading", { name: "Subjects · 0" })).toBeVisible();
    await expect
      .element(details().getByText("No Subjects yet, so the bot can’t offer them to Guardians."))
      .toBeVisible();
  });

  it("shows a bio when there is one", async () => {
    respond(network.get, { staff: [makeStaff({ bio: "Loves fractions." })] });
    await renderApp("/staff/u-ana");
    await expect.element(details().getByText("Loves fractions.")).toBeVisible();
  });

  it.each([
    ["not invited", makeStaff({ sign_in_state: "not_invited" }), () => "Not invited: can’t sign in yet"],
    ["invited", DAN, () => `Invited. The Invite lasts until ${formatShort(DAN.invite_expires_at ?? "")}.`],
  ])("puts a %s sign-in state in words", async (_, staff, sentence) => {
    respond(network.get, { staff: [staff] });
    await renderApp(`/staff/${staff.id}`);
    await expect.element(details().getByText(sentence())).toBeVisible();
  });

  it("says when an Invite expired", async () => {
    const expiredAt = new Date(Date.now() - 2 * DAY_MS).toISOString();
    respond(network.get, {
      staff: [makeStaff({ sign_in_state: "invited", invite_expires_at: expiredAt })],
    });
    await renderApp("/staff/u-ana");
    await expect
      .element(
        details().getByText(`Invited. The Invite expired ${formatShort(expiredAt)}; send it again.`),
      )
      .toBeVisible();
  });
});

describe("Staff details at 390", () => {
  beforeEach(async () => {
    await page.viewport(PHONE.width, PHONE.height);
  });

  it("is a pushed page with ← Staff and a pinned header", async () => {
    await renderApp("/staff/u-ana");
    const back = details().getByRole("button", { name: "Staff", exact: true });
    await expect.element(back).toBeVisible();
    const badge = details().getByText("Active", { exact: true });
    await expect.element(badge).toBeVisible();
    const box = details().element().getBoundingClientRect();
    expect(box.width).toBe(PHONE.width);
    const header = badge.element().closest(".sticky");
    expect(header).not.toBeNull();
    await back.click();
    expect(getPath()).toBe("/staff");
  });

  it("says ← Archived when opened from the Archived tab", async () => {
    await renderApp(`/staff/${ZOE.id}?list=archived`);
    await expect
      .element(details().getByRole("button", { name: "Archived", exact: true }))
      .toBeVisible();
  });

  it("scrolls five tabs sideways inside the page", async () => {
    await renderApp("/staff/u-ana");
    await expect.element(sections()).toBeVisible();
    const nav = sections().element();
    expect(getComputedStyle(nav).overflowX).toBe("auto");
    expect(nav.scrollWidth).toBeGreaterThan(nav.clientWidth);
  });
});
