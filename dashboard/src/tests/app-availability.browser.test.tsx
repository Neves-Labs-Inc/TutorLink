import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { App } from "@/App";
import type { Role } from "@/lib/auth/auth";
import { useAuthStore } from "@/stores/authStore";
import { renderWithProviders } from "@/test/render-with-providers";

const ME = {
  id: "u-7",
  email: "marco@example.com",
  role: "tutor",
  name: "Marco Rossi",
  tutor_id: "t-7",
  office_phone: null,
  welcome_seen: true,
};
const EMPTY_WEEK = { items: [], total: 0, page: 1, page_size: 100 };

const network = vi.hoisted(() => ({ get: vi.fn(), refresh: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get },
  refreshSession: network.refresh,
}));

const startUrl = window.location.href;

async function openApp(role: Role, path: string): Promise<void> {
  useAuthStore.setState({ status: "authenticated", role });
  window.history.pushState(null, "", path);
  await renderWithProviders(<App />);
}

beforeEach(async () => {
  await page.viewport(1280, 800);
  network.get.mockReset();
  network.refresh.mockResolvedValue("token");
  network.get.mockImplementation(async (url: string) => ({
    data: url === "/api/me" ? ME : EMPTY_WEEK,
  }));
});

afterEach(() => {
  window.history.replaceState(null, "", startUrl);
});

describe("/availability", () => {
  it("opens My availability for a Tutor and marks its nav item", async () => {
    await openApp("tutor", "/availability");
    await expect
      .element(page.getByRole("heading", { name: "My availability", level: 1 }))
      .toBeVisible();
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect
      .element(nav.getByRole("button", { name: "My availability" }))
      .toHaveAttribute("aria-current", "page");
  });

  it("redirects the old /schedule to /availability", async () => {
    await openApp("tutor", "/schedule");
    await expect
      .element(page.getByRole("heading", { name: "My availability", level: 1 }))
      .toBeVisible();
    expect(window.location.pathname).toBe("/availability");
  });

  it("is reached from the Tutor's nav", async () => {
    await openApp("tutor", "/profile");
    const nav = page.getByRole("navigation", { name: "Main" });
    await nav.getByRole("button", { name: "My availability" }).click();
    await expect
      .element(page.getByRole("heading", { name: "My availability", level: 1 }))
      .toBeVisible();
    expect(window.location.pathname).toBe("/availability");
  });

  it("keeps office roles out", async () => {
    // The office landing page's own reads never answer; only the redirect matters.
    network.get.mockImplementation((url: string) =>
      url === "/api/me"
        ? Promise.resolve({ data: { ...ME, role: "manager" } })
        : new Promise(() => {}),
    );
    await openApp("manager", "/availability");
    await expect.element(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    expect(window.location.pathname).not.toBe("/availability");
  });
});
