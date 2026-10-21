import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { App } from "@/App";
import { useAuthStore } from "@/stores/authStore";
import { renderWithProviders } from "@/test/render-with-providers";

const ME = {
  id: "u-1",
  email: "maria@example.com",
  role: "admin",
  name: "Maria Lopes",
  tutor_id: null,
  office_phone: null,
  welcome_seen: true,
};
const EMPTY_PAGE = { items: [], total: 0, page: 1, page_size: 20 };

const network = vi.hoisted(() => ({ get: vi.fn(), refresh: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get },
  refreshSession: network.refresh,
}));

const startUrl = window.location.href;

beforeEach(async () => {
  await page.viewport(1280, 800);
  network.get.mockReset();
  network.refresh.mockResolvedValue("token");
  // Home's lists come back empty; the shell's counts never answer.
  network.get.mockImplementation((url: string) => {
    if (url === "/api/me") return Promise.resolve({ data: ME });
    if (url === "/api/counts") return new Promise(() => {});
    return Promise.resolve({ data: EMPTY_PAGE });
  });
});

afterEach(() => {
  window.history.replaceState(null, "", startUrl);
});

describe("/home", () => {
  it("redirects the old /dashboard to Home", async () => {
    useAuthStore.setState({ status: "authenticated", role: "admin", userId: "u-1" });
    window.history.pushState(null, "", "/dashboard");
    await renderWithProviders(<App />);

    await expect
      .element(page.getByRole("heading", { level: 2, name: "To do" }))
      .toBeVisible();
    expect(window.location.pathname).toBe("/home");
  });
});
