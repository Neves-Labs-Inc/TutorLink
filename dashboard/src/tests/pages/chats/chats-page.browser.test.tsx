import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { App } from "@/App";
import type { CountsRead } from "@/components/kit/shell/nav";
import type { Role } from "@/lib/auth/auth";
import { useAuthStore } from "@/stores/authStore";
import { renderWithProviders } from "@/test/render-with-providers";

const SPLIT_VIEWPORT = { width: 1280, height: 800 };
const STACKED_VIEWPORT = { width: 900, height: 800 };

const network = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get },
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const ME = { id: "u-1", email: "rita@example.com", role: "admin", name: "Rita" };
const COUNTS: CountsRead = {
  needs_attention: 2,
  time_off_pending: 0,
  children_awaiting_evaluation: 0,
  bookings_to_sort_out: 0,
  children_needing_tutor: 0,
  unread_chats: 3,
};

function respond(counts: () => Promise<unknown> = async () => COUNTS): void {
  network.get.mockImplementation(async (url: string) => ({
    data: url === "/api/me" ? ME : await counts(),
  }));
}

async function renderAt(path: string, role: Role = "admin"): Promise<void> {
  window.history.pushState({}, "", path);
  useAuthStore.setState({ status: "authenticated", role });
  await renderWithProviders(<App />);
}

const heading = () => page.getByRole("heading", { name: "Chats", level: 1 });
const tabs = () => page.getByRole("navigation", { name: "Chats sections" });

beforeEach(async () => {
  await page.viewport(SPLIT_VIEWPORT.width, SPLIT_VIEWPORT.height);
  network.get.mockReset();
  respond();
});

describe("Chats routes", () => {
  it.each(["admin", "manager", "developer"] as const)(
    "shows the Chats page to a %s",
    async (role) => {
      await renderAt("/chats", role);
      await expect.element(heading()).toBeVisible();
    },
  );

  it("refuses a Tutor", async () => {
    await renderAt("/chats", "tutor");
    await vi.waitFor(() =>
      expect(window.location.pathname).not.toContain("/chats"),
    );
    expect(heading().elements()).toHaveLength(0);
  });

  it("opens a chat on /chats/:id", async () => {
    await renderAt("/chats/abc");
    await expect.element(page.getByText("Chat abc")).toBeVisible();
  });

  it("shows Reminders on /chats/reminders, not a chat called reminders", async () => {
    await renderAt("/chats/reminders");
    await expect
      .element(page.getByRole("button", { name: "Reminders" }))
      .toHaveAttribute("aria-current", "page");
    expect(page.getByText("Chat reminders").elements()).toHaveLength(0);
  });

  it("redirects /reminders to /chats/reminders, keeping the week", async () => {
    await renderAt("/reminders?week=2026-10-12");
    await expect.element(heading()).toBeVisible();
    expect(window.location.pathname).toBe("/chats/reminders");
    expect(window.location.search).toBe("?week=2026-10-12");
  });
});

describe("Chats header", () => {
  it("describes the counts and puts the unread count on the tab", async () => {
    await renderAt("/chats");
    await expect
      .element(page.getByText("unread ·", { exact: false }))
      .toHaveTextContent("3 unread · 2 need attention");
    await expect
      .element(tabs().getByRole("button", { name: /Conversations/ }))
      .toHaveTextContent("3");
  });

  it("marks the open tab with aria-current and navigates between tabs", async () => {
    await renderAt("/chats");
    const conversations = tabs().getByRole("button", { name: /Conversations/ });
    await expect.element(conversations).toHaveAttribute("aria-current", "page");

    await userEvent.click(tabs().getByRole("button", { name: "Reminders" }));
    expect(window.location.pathname).toBe("/chats/reminders");
    await expect
      .element(tabs().getByRole("button", { name: "Reminders" }))
      .toHaveAttribute("aria-current", "page");
  });

  it("hides the tab count at zero", async () => {
    respond(async () => ({ ...COUNTS, unread_chats: 0 }));
    await renderAt("/chats");
    await expect
      .element(page.getByText("0 unread · 2 need attention"))
      .toBeVisible();
    await expect
      .element(tabs().getByRole("button", { name: /Conversations/ }))
      .toHaveTextContent(/^Conversations$/);
  });

  it("omits the description and tab count when counts fail", async () => {
    respond(async () => {
      throw new Error("down");
    });
    await renderAt("/chats");
    await expect.element(heading()).toBeVisible();
    await expect
      .element(tabs().getByRole("button", { name: /Conversations/ }))
      .toHaveTextContent(/^Conversations$/);
    expect(page.getByText("unread ·", { exact: false }).elements()).toHaveLength(0);
  });

  it("highlights the Chats nav item on every Chats route", async () => {
    await renderAt("/chats/abc");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect
      .element(nav.getByRole("button", { name: /Chats/ }).first())
      .toHaveAttribute("aria-current", "page");
  });
});

describe("Conversations layout", () => {
  it("shows the Pick a chat pane next to the list from 1152px", async () => {
    await renderAt("/chats");
    await expect.element(page.getByText("Pick a chat")).toBeVisible();
    await expect
      .element(page.getByText("2 need attention. They’re at the top of the list."))
      .toBeVisible();
  });

  it("asks to choose a chat when nothing needs attention", async () => {
    respond(async () => ({ ...COUNTS, needs_attention: 0 }));
    await renderAt("/chats");
    await expect
      .element(page.getByText("Choose a chat on the left to read it and reply."))
      .toBeVisible();
  });

  it("puts the open chat in the pane when split and keeps the search params on close", async () => {
    await renderAt("/chats/abc?q=maria&unread=1");
    const thread = page.getByRole("region", { name: "Chat" });
    await expect.element(thread).toHaveAttribute("data-container", "pane");

    await userEvent.click(page.getByRole("button", { name: "Close chat" }));
    expect(window.location.pathname).toBe("/chats");
    expect(window.location.search).toBe("?q=maria&unread=1");
  });

  it("shows the list alone, and the chat as an overlay, below 1152px", async () => {
    await page.viewport(STACKED_VIEWPORT.width, STACKED_VIEWPORT.height);
    await renderAt("/chats/abc");
    await expect
      .element(page.getByRole("region", { name: "Chat" }))
      .toHaveAttribute("data-container", "overlay");
    expect(page.getByText("Pick a chat").elements()).toHaveLength(0);
  });

  it("keeps the open chat when the width crosses 1152px", async () => {
    await page.viewport(STACKED_VIEWPORT.width, STACKED_VIEWPORT.height);
    await renderAt("/chats/abc");
    await page.viewport(SPLIT_VIEWPORT.width, SPLIT_VIEWPORT.height);
    await expect
      .element(page.getByRole("region", { name: "Chat" }))
      .toHaveAttribute("data-container", "pane");
    expect(window.location.pathname).toBe("/chats/abc");
  });
});
