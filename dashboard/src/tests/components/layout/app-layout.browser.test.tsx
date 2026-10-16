import { focusManager } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import AppLayout from "@/components/layout/app-layout";
import type { CountsRead } from "@/components/kit/shell/nav";
import type { Role } from "@/lib/auth/auth";
import { useAuthStore } from "@/stores/authStore";
import { renderWithProviders } from "@/test/render-with-providers";

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 375, height: 800 };
const NARROW_PHONE = { width: 320, height: 640 };
const MIN_TOUCH_PX = 44;
const COUNTS_REFRESH_MS = 60_000;

const ME = { id: "u-1", email: "rita@example.com", role: "admin", name: "Rita Souza" };
const COUNTS: CountsRead = {
  needs_attention: 1,
  time_off_pending: 4,
  children_awaiting_evaluation: 2,
  bookings_to_sort_out: 3,
  unread_chats: 7,
};

const network = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/lib/api", () => ({ api: { get: network.get } }));

type Responses = {
  me?: () => Promise<unknown>;
  counts?: () => Promise<unknown>;
};

function never(): Promise<never> {
  return new Promise(() => {});
}

function respond({
  me = async () => ME,
  counts = async () => COUNTS,
}: Responses = {}): void {
  network.get.mockImplementation(async (url: string) => {
    const body = url === "/api/me" ? await me() : await counts();
    return { data: body };
  });
}

function getCountRequests(): number {
  return network.get.mock.calls.filter(([url]) => url === "/api/counts")
    .length;
}

function CurrentPath(): ReactNode {
  return <p data-testid="path">{useLocation().pathname}</p>;
}

async function renderShell(role: Role, path: string): Promise<void> {
  useAuthStore.setState({ status: "authenticated", role });
  await renderWithProviders(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="*" element={<CurrentPath />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function getNavLabels(): string[] {
  const nav = page.getByRole("navigation", { name: "Main" });
  return nav
    .getByRole("button")
    .elements()
    .map((element) => element.textContent?.trim() ?? "");
}

const currentPath = () => page.getByTestId("path");
const mainNav = () => page.getByRole("navigation", { name: "Main" });

beforeEach(() => {
  network.get.mockReset();
  respond();
});

afterEach(() => {
  vi.useRealTimers();
  focusManager.setFocused(undefined);
});

describe("app shell from 1024px", () => {
  beforeEach(async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height);
  });

  it("gives an Admin the full nav, each item opening its path", async () => {
    await renderShell("admin", "/dashboard");
    const nav = mainNav();
    await expect.element(nav.getByText("7 unread")).toBeVisible();
    expect(getNavLabels()).toEqual([
      "Home",
      "Bookings5 to sort out",
      "Chats7 unread",
      "Families",
      "Staff",
      "Settings",
    ]);

    await nav.getByRole("button", { name: /Families/ }).click();
    await expect.element(currentPath()).toHaveTextContent("/children");
    await nav.getByRole("button", { name: /Staff/ }).click();
    await expect.element(currentPath()).toHaveTextContent("/tutors");
  });

  it("gives a Developer the Admin nav", async () => {
    await renderShell("developer", "/dashboard");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect.element(nav.getByRole("button", { name: /Settings/ })).toBeVisible();
  });

  it("gives a Manager the office nav without Settings", async () => {
    await renderShell("manager", "/dashboard");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect.element(nav.getByRole("button", { name: /Staff/ })).toBeVisible();
    expect(getNavLabels().map((label) => label.replace(/\d.*/, ""))).toEqual([
      "Home",
      "Bookings",
      "Chats",
      "Families",
      "Staff",
    ]);
  });

  it("gives a Tutor their nav and never asks for counts", async () => {
    await renderShell("tutor", "/sessions");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect.element(nav.getByRole("button", { name: "Time off" })).toBeVisible();
    expect(getNavLabels()).toEqual(["My sessions", "My availability", "Time off"]);
    await expect
      .element(nav.getByRole("button", { name: "My sessions" }))
      .toHaveAttribute("aria-current", "page");

    await nav.getByRole("button", { name: "My availability" }).click();
    await expect.element(currentPath()).toHaveTextContent("/schedule");
    expect(getCountRequests()).toBe(0);
  });

  it.each([
    ["/guardians/g-1", /Families/],
    ["/users", /Staff/],
    ["/reminders", /Chats/],
  ])("marks the nearest item on %s", async (path, item) => {
    await renderShell("admin", path);
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect
      .element(nav.getByRole("button", { name: item }))
      .toHaveAttribute("aria-current", "page");
    expect(
      nav.getByRole("button").elements().filter((element) => element.ariaCurrent),
    ).toHaveLength(1);
  });

  it("shows no badges while counts load", async () => {
    respond({ counts: never });
    await renderShell("admin", "/dashboard");
    await expect.element(page.getByText("Rita Souza")).toBeVisible();
    expect(getNavLabels()).toContain("Bookings");
    expect(getNavLabels()).toContain("Chats");
  });

  it("shows no badges and no message when counts fail", async () => {
    respond({ counts: async () => Promise.reject(new Error("500")) });
    await renderShell("admin", "/dashboard");
    await expect.element(page.getByText("Rita Souza")).toBeVisible();
    await vi.waitFor(() => expect(getCountRequests()).toBeGreaterThan(0));
    expect(getNavLabels()).toContain("Bookings");
    expect(page.getByRole("alert").elements()).toHaveLength(0);
  });

  it("refetches counts when the window regains focus", async () => {
    await renderShell("admin", "/dashboard");
    await expect.element(mainNav().getByText("7 unread")).toBeVisible();
    respond({ counts: async () => ({ ...COUNTS, unread_chats: 9 }) });

    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await expect.element(mainNav().getByText("9 unread")).toBeVisible();
  });

  it("refetches counts every 60 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await renderShell("admin", "/dashboard");
    await expect.element(mainNav().getByText("7 unread")).toBeVisible();
    respond({ counts: async () => ({ ...COUNTS, unread_chats: 9 }) });

    vi.advanceTimersByTime(COUNTS_REFRESH_MS);
    await expect.element(mainNav().getByText("9 unread")).toBeVisible();
  });

  it("opens Profile from the person card", async () => {
    await renderShell("admin", "/dashboard");
    const card = page.getByRole("button", { name: /Rita Souza/ });
    await expect.element(card).toHaveTextContent("Admin");

    await card.click();
    await expect.element(currentPath()).toHaveTextContent("/profile");
    await expect.element(card).toHaveAttribute("aria-current", "page");
  });

  it("shows a skeleton and the role while the person loads", async () => {
    respond({ me: never });
    await renderShell("manager", "/dashboard");
    const loading = page.getByRole("status", { name: "Loading your name" });
    await expect.element(loading).toBeVisible();
    await expect.element(page.getByText("Manager")).toBeVisible();
  });

  it("keeps the person card's height when the person lands", async () => {
    let resolveMe: (me: unknown) => void = () => {};
    respond({ me: () => new Promise((resolve) => (resolveMe = resolve)) });
    await renderShell("admin", "/dashboard");
    const loading = page.getByRole("status", { name: "Loading your name" });
    await expect.element(loading).toBeVisible();
    const card = page.getByRole("button", { name: /Your profile/ }).first();
    const loadingHeight = card.element().getBoundingClientRect().height;

    resolveMe(ME);
    await expect.element(page.getByText("Rita Souza")).toBeVisible();
    expect(card.element().getBoundingClientRect().height).toBe(loadingHeight);
  });

  it("names the card Your profile when the person fails to load", async () => {
    respond({ me: async () => Promise.reject(new Error("500")) });
    await renderShell("admin", "/dashboard");
    const card = page.getByRole("button", { name: /Your profile/ }).first();
    await expect.element(card).toHaveTextContent("Your profile");
    await expect.element(card).toHaveTextContent("Admin");

    await card.click();
    await expect.element(currentPath()).toHaveTextContent("/profile");
  });
});

describe("app shell below 1024px", () => {
  beforeEach(async () => {
    await page.viewport(PHONE.width, PHONE.height);
  });

  it("gives an Admin 4 tabs and More, with Staff and Settings inside", async () => {
    await renderShell("admin", "/settings");
    const nav = page.getByRole("navigation", { name: "Main" });
    const more = nav.getByRole("button", { name: "More" });
    await expect.element(nav.getByText("7 unread")).toBeVisible();
    // A tab's corner badge comes before its label.
    expect(getNavLabels()).toEqual([
      "Home",
      "5 to sort outBookings",
      "7 unreadChats",
      "Families",
      "More",
    ]);
    expect(more.element().ariaCurrent).toBeNull();

    await more.click();
    const sheet = page.getByRole("dialog", { name: "More" });
    await expect
      .element(sheet.getByRole("button", { name: "Settings" }))
      .toHaveAttribute("aria-current", "page");

    await sheet.getByRole("button", { name: "Staff" }).click();
    await expect.element(currentPath()).toHaveTextContent("/tutors");
  });

  it("gives a Manager 5 tabs and no More", async () => {
    await renderShell("manager", "/dashboard");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect.element(nav.getByRole("button", { name: "Staff" })).toBeVisible();
    expect(nav.getByRole("button", { name: "More" }).elements()).toHaveLength(0);
  });

  it("opens Profile from the avatar button", async () => {
    await renderShell("tutor", "/sessions");
    const avatar = page.getByRole("button", { name: "Your profile: Rita Souza" });
    await expect.element(avatar).toBeVisible();

    await avatar.click();
    await expect.element(currentPath()).toHaveTextContent("/profile");
    await expect.element(avatar).toHaveAttribute("aria-current", "page");
  });

  it("names the avatar Your profile while the person loads", async () => {
    respond({ me: never });
    await renderShell("tutor", "/sessions");
    await expect
      .element(page.getByRole("button", { name: "Your profile", exact: true }))
      .toBeVisible();
  });

  it("fits 320px with 44px targets and no sideways scroll", async () => {
    await page.viewport(NARROW_PHONE.width, NARROW_PHONE.height);
    await renderShell("admin", "/dashboard");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect.element(nav.getByRole("button", { name: "More" })).toBeVisible();

    const targets = [
      ...nav.getByRole("button").elements(),
      page.getByRole("button", { name: /Your profile/ }).element(),
    ];
    for (const target of targets) {
      expect(target.getBoundingClientRect().height).toBeGreaterThanOrEqual(
        MIN_TOUCH_PX,
      );
    }
    const scroll = document.querySelector("[data-kit-scroll]");
    expect(scroll?.scrollWidth).toBeLessThanOrEqual(NARROW_PHONE.width);
  });
});
