import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { App } from "@/App";
import type { Role } from "@/lib/auth/auth";
import { useAuthStore } from "@/stores/authStore";
import { renderWithProviders } from "@/test/render-with-providers";

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

function answerOnlyMe(role: Role): void {
  // Every other read never answers; only where the person lands matters.
  network.get.mockImplementation((url: string) =>
    url === "/api/me"
      ? Promise.resolve({ data: { id: "u-1", email: "a@example.com", role, name: "Ana Lima" } })
      : new Promise(() => {}),
  );
}

beforeEach(async () => {
  await page.viewport(1280, 800);
  network.get.mockReset();
  network.refresh.mockResolvedValue("token");
});

afterEach(() => {
  window.history.replaceState(null, "", startUrl);
});

describe("/settings", () => {
  it("tells a Manager Settings are for Admins without loading them", async () => {
    answerOnlyMe("manager");
    await openApp("manager", "/settings");

    await expect
      .element(page.getByRole("heading", { name: "Settings are for Admins" }))
      .toBeVisible();
    expect(window.location.pathname).toBe("/settings");
    expect(network.get).not.toHaveBeenCalledWith("/api/settings");
  });

  it("opens Settings for an Admin", async () => {
    answerOnlyMe("admin");
    await openApp("admin", "/settings");

    await expect
      .element(page.getByRole("status", { name: "Loading settings" }))
      .toBeVisible();
    expect(network.get).toHaveBeenCalledWith("/api/settings");
  });

  it("redirects a Tutor away", async () => {
    answerOnlyMe("tutor");
    await openApp("tutor", "/settings");

    await expect.element(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await vi.waitFor(() => expect(window.location.pathname).not.toBe("/settings"));
  });
});
