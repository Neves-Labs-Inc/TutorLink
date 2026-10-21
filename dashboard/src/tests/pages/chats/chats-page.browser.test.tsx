import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { App } from "@/App";
import type { CountsRead } from "@/components/kit/shell/nav";
import type { Role } from "@/lib/auth/auth";
import { useAuthStore } from "@/stores/authStore";
import { renderWithProviders } from "@/test/render-with-providers";

const SPLIT_VIEWPORT = { width: 1280, height: 800 };
const STACKED_VIEWPORT = { width: 900, height: 800 };

const network = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get, post: network.post },
}));
vi.mock("@/hooks/use-conversation-stream/useConversationStream", () => ({
  useConversationStream: () => ({
    status: "connected",
    error: null,
    errorCode: null,
    send: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-conversation-stream/useConversationStream", () => ({
  useConversationStream: () => ({ send: vi.fn(), status: "connected" }),
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

const CHAT = {
  id: "abc",
  phone_number: "+13055550142",
  guardian: { id: "g1", name: "Diana Gómez" },
  status: "bot",
  taken_over_by: null,
  last_message_at: "2026-10-20T12:00:00Z",
  flag_reason: null,
  intake_in_progress: false,
  taken_over_at: null,
  last_read_at: "2026-10-20T12:00:00Z",
  message_count: 0,
  unread_count: 0,
  created_at: "2026-10-01T12:00:00Z",
  reactivation_request: null,
  flagged_at: null,
  is_window_open: false,
  last_client_message_at: "2026-10-01T12:00:00Z",
  language: null,
};
const NO_MESSAGES = { items: [], total: 0, page: 1, page_size: 20 };
const NO_BOOKINGS = { items: [], total: 0, page: 1, page_size: 20 };
const NO_CHATS = { items: [], total: 0, page: 1, page_size: 20 };

function respond(counts: () => Promise<unknown> = async () => COUNTS): void {
  network.get.mockImplementation(async (url: string) => {
    let data: unknown;
    if (url === "/api/me") {
      data = ME;
    } else if (url === "/api/conversations") {
      data = NO_CHATS;
    } else if (url.startsWith("/api/bookings")) {
      // A Tutor redirected off Chats lands on My sessions, which lists bookings.
      data = NO_BOOKINGS;
    } else if (url.endsWith("/messages")) {
      data = NO_MESSAGES;
    } else if (url.startsWith("/api/conversations/")) {
      data = CHAT;
    } else {
      data = await counts();
    }
    return { data };
  });
  network.post.mockResolvedValue({ data: CHAT });
}

async function renderAt(path: string, role: Role = "admin"): Promise<void> {
  window.history.pushState({}, "", path);
  useAuthStore.setState({ status: "authenticated", role });
  await renderWithProviders(<App />);
}

const heading = () => page.getByRole("heading", { name: "Chats", level: 1 });
const tabs = () => page.getByRole("navigation", { name: "Chats sections" });
const thread = () => page.getByRole("region", { name: "Chat with Diana Gómez" });
const overlay = () => page.getByRole("dialog", { name: "Chat with Diana Gómez" });

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
    await expect.element(thread()).toBeVisible();
  });

  it("shows Reminders on /chats/reminders, not a chat called reminders", async () => {
    await renderAt("/chats/reminders");
    await expect
      .element(page.getByRole("button", { name: "Reminders" }))
      .toHaveAttribute("aria-current", "page");
    expect(network.get).not.toHaveBeenCalledWith("/api/conversations/reminders");
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

  it("puts the open chat in the pane when split, with no overlay", async () => {
    await renderAt("/chats/abc?q=maria&unread=1");
    await expect.element(thread()).toBeVisible();
    expect(page.getByRole("dialog").elements()).toHaveLength(0);
  });

  it("shows the list alone, and the chat as an overlay that keeps the search params on close, below 1152px", async () => {
    await page.viewport(STACKED_VIEWPORT.width, STACKED_VIEWPORT.height);
    await renderAt("/chats/abc?q=maria&unread=1");
    await expect.element(overlay()).toBeVisible();
    expect(page.getByText("Pick a chat").elements()).toHaveLength(0);

    await userEvent.click(overlay().getByRole("button", { name: "Close" }));
    expect(window.location.pathname).toBe("/chats");
    expect(window.location.search).toBe("?q=maria&unread=1");
  });

  it("keeps the open chat when the width crosses 1152px", async () => {
    await page.viewport(STACKED_VIEWPORT.width, STACKED_VIEWPORT.height);
    await renderAt("/chats/abc");
    await expect.element(overlay()).toBeVisible();
    await page.viewport(SPLIT_VIEWPORT.width, SPLIT_VIEWPORT.height);
    await expect.element(thread()).toBeVisible();
    expect(page.getByRole("dialog").elements()).toHaveLength(0);
    expect(window.location.pathname).toBe("/chats/abc");
  });
});
