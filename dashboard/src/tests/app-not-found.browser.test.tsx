import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { App } from "@/App";
import type { Role } from "@/lib/auth/auth";
import type { AuthStatus } from "@/stores/authStore";
import { useAuthStore } from "@/stores/authStore";
import { renderWithProviders } from "@/test/render-with-providers";

const network = vi.hoisted(() => ({ get: vi.fn(), refresh: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get },
  refreshSession: network.refresh,
}));

const startUrl = window.location.href;
const NOT_FOUND_TITLE = "We can’t find that page";

async function openApp(
  status: AuthStatus,
  role: Role | null,
  path: string,
): Promise<void> {
  useAuthStore.setState({ status, role });
  window.history.pushState(null, "", path);
  await renderWithProviders(<App />);
}

beforeEach(async () => {
  await page.viewport(1280, 800);
  network.get.mockReset();
  network.get.mockImplementation(() => new Promise(() => {}));
  network.refresh.mockResolvedValue("token");
});

afterEach(() => {
  window.history.replaceState(null, "", startUrl);
});

describe("while the session is checked", () => {
  it("shows the logo splash on a signed-in page, never a blank page", async () => {
    await openApp("loading", null, "/home");

    await expect
      .element(page.getByRole("status", { name: "Checking your session" }))
      .toBeVisible();
    expect(document.body.textContent).not.toContain("Checking your session");
  });

  it("shows the splash on an unknown URL too", async () => {
    await openApp("loading", null, "/nope");

    await expect
      .element(page.getByRole("status", { name: "Checking your session" }))
      .toBeVisible();
  });
});

describe("an unknown URL, signed in", () => {
  it.each([
    ["admin", "Go to Home", "/home"],
    ["manager", "Go to Home", "/home"],
    ["tutor", "Go to My sessions", "/sessions"],
  ] as const)(
    "shows not found inside the shell for a %s and goes to their landing page",
    async (role, buttonName, landing) => {
      await openApp("authenticated", role, "/nope");

      await expect
        .element(page.getByRole("heading", { name: "Page not found", level: 1 }))
        .toBeVisible();
      await expect
        .element(page.getByRole("heading", { name: NOT_FOUND_TITLE }))
        .toBeVisible();
      await expect
        .element(page.getByRole("navigation", { name: "Main" }))
        .toBeVisible();
      expect(document.querySelectorAll("h1")).toHaveLength(1);
      expect(document.querySelector("[aria-current]")).toBeNull();

      await page.getByRole("button", { name: buttonName }).click();
      await vi.waitFor(() => expect(window.location.pathname).toBe(landing));
    },
  );
});

describe("a removed prototype URL", () => {
  it.each(["/prototype/tutor-timeoff", "/prototype/accounts-staff"])(
    "shows not found for %s",
    async (path) => {
      await openApp("authenticated", "admin", path);

      await expect
        .element(page.getByRole("heading", { name: NOT_FOUND_TITLE }))
        .toBeVisible();
    },
  );
});

describe("an unknown URL, signed out", () => {
  it("shows the brand-frame not found and goes to sign in", async () => {
    await openApp("anonymous", null, "/nope");

    await expect
      .element(page.getByRole("heading", { name: NOT_FOUND_TITLE, level: 1 }))
      .toBeVisible();
    await expect
      .element(page.getByText("Nothing is lost; start again from sign in."))
      .toBeVisible();

    await page.getByRole("button", { name: "Go to sign in" }).click();
    await vi.waitFor(() => expect(window.location.pathname).toBe("/login"));
  });
});
