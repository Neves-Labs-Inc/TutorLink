import { notifyManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { App } from "@/App";
import type { CountsRead } from "@/components/kit/shell/nav";
import { UNDO_WINDOW_MS } from "@/components/kit/overlays/use-deferred-action";
import type {
  ConversationStreamStatus,
  UseConversationStreamHandlers,
} from "@/hooks/use-conversation-stream/useConversationStream";
import type {
  Conversation,
  ConversationDetail,
  Message,
} from "@/lib/queries/conversations";
import type { Page } from "@/lib/queries/page";
import { useAuthStore } from "@/stores/authStore";
import { createTestQueryClient, renderWithProviders } from "@/test/render-with-providers";

const SPLIT_VIEWPORT = { width: 1280, height: 800 };
const PHONE_VIEWPORT = { width: 375, height: 760 };
const HOUR_MS = 3_600_000;
const LONG_AFTER_WINDOW_MS = UNDO_WINDOW_MS * 3;

const network = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));
const stream = vi.hoisted(() => ({
  handlers: {} as UseConversationStreamHandlers,
  status: "connected" as ConversationStreamStatus,
  send: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: network,
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/hooks/use-conversation-stream/useConversationStream", () => ({
  useConversationStream: (handlers: UseConversationStreamHandlers = {}) => {
    stream.handlers = handlers;
    return { status: stream.status, error: null, errorCode: null, send: stream.send };
  },
}));

const ME = { id: "u-1", email: "rita@example.com", role: "admin", name: "Rita Alves" };
const MARIA = { id: "u-2", name: "Maria Silva" };
const COUNTS: CountsRead = {
  needs_attention: 0,
  time_off_pending: 0,
  children_awaiting_evaluation: 0,
  bookings_to_sort_out: 0,
  children_needing_tutor: 0,
  unread_chats: 0,
};

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * HOUR_MS).toISOString();
}

function makeDetail(overrides: Partial<ConversationDetail> = {}): ConversationDetail {
  return {
    id: "c1",
    phone_number: "+13055550142",
    guardian: { id: "g1", name: "Diana Gómez" },
    status: "bot",
    taken_over_by: null,
    last_message_at: hoursAgo(1),
    flag_reason: null,
    intake_in_progress: false,
    taken_over_at: null,
    last_read_at: hoursAgo(1),
    message_count: 0,
    unread_count: 0,
    created_at: hoursAgo(48),
    reactivation_request: null,
    flagged_at: null,
    is_window_open: true,
    last_client_message_at: hoursAgo(1),
    language: "en",
    ...overrides,
  };
}

const MINE: Partial<ConversationDetail> = {
  status: "human",
  taken_over_by: { id: ME.id, name: ME.name },
  taken_over_at: hoursAgo(1),
};
const MARIAS: Partial<ConversationDetail> = {
  status: "human",
  taken_over_by: MARIA,
  taken_over_at: hoursAgo(1),
};
// Closed at a fixed time, so the notice's date reads the same in any run.
const CLOSED: Partial<ConversationDetail> = {
  is_window_open: false,
  last_client_message_at: "2026-10-17T21:00:00Z",
};

function toRow(detail: ConversationDetail): Conversation {
  return {
    id: detail.id,
    phone_number: detail.phone_number,
    guardian: detail.guardian,
    status: detail.status,
    taken_over_by: detail.taken_over_by,
    last_message_at: detail.last_message_at,
    last_message_preview: "Hello",
    unread: false,
    flag_reason: detail.flag_reason,
    intake_in_progress: detail.intake_in_progress,
    last_client_message_at: detail.last_client_message_at,
    is_window_open: detail.is_window_open,
    flagged_at: detail.flagged_at,
  };
}

function toPage<T>(items: T[]): Page<T> {
  return { items, total: items.length, page: 1, page_size: 20 };
}

let detail: ConversationDetail;
let messages: Message[];

function wireNetwork(): void {
  network.get.mockImplementation(async (url: string) => {
    if (url === "/api/me") return { data: ME };
    if (url === "/api/counts") return { data: COUNTS };
    if (url === "/api/conversations") return { data: toPage([toRow(detail)]) };
    if (url.endsWith("/messages")) return { data: toPage([...messages].reverse()) };
    if (url === "/api/conversations/c1") return { data: detail };
    throw new Error(`unexpected GET ${url}`);
  });
  network.post.mockImplementation(async (url: string) => {
    if (url.endsWith("/read")) return { data: detail };
    throw new Error(`unexpected POST ${url}`);
  });
  network.delete.mockImplementation(async (url: string) => {
    throw new Error(`unexpected DELETE ${url}`);
  });
}

function conflict(): Error {
  return Object.assign(new Error("Request failed with status code 409"), {
    isAxiosError: true,
    response: { status: 409, data: { detail: "refused" } },
  });
}

async function renderAt(path = "/chats/c1") {
  const queryClient = createTestQueryClient();
  window.history.pushState({}, "", path);
  useAuthStore.setState({ status: "authenticated", role: "admin", accessToken: "token" });
  await renderWithProviders(<App />, queryClient);
  return queryClient;
}

function detailFetches(): number {
  return network.get.mock.calls.filter(([url]) => url === "/api/conversations/c1").length;
}

beforeEach(async () => {
  await page.viewport(SPLIT_VIEWPORT.width, SPLIT_VIEWPORT.height);
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  stream.handlers = {};
  stream.status = "connected";
  detail = makeDetail();
  messages = [];
  wireNetwork();
});

const pane = () => page.getByRole("region", { name: "Chat with Diana Gómez" });
const footer = () => pane().element().querySelector<HTMLElement>('[data-slot="thread-footer"]');
const reply = () => page.getByRole("textbox", { name: "Reply" });
const takeOver = () => page.getByRole("button", { name: "Take over", exact: true });
const undo = () => page.getByRole("button", { name: "Undo" });

describe("Footer states", () => {
  it("offers Take over when the bot is answering", async () => {
    await renderAt();
    await expect
      .element(
        pane().getByText(
          "The bot is answering. Take over to reply to Diana yourself; they’re told you’ve joined.",
        ),
      )
      .toBeVisible();
    await expect.element(takeOver()).toBeVisible();
    expect(reply().elements()).toHaveLength(0);
  });

  it("names the colleague replying and offers to take over from them", async () => {
    detail = makeDetail(MARIAS);
    await renderAt();
    await expect.element(pane().getByText("Maria is replying in this chat.")).toBeVisible();
    await expect
      .element(pane().getByRole("button", { name: "Take over from Maria" }))
      .toBeVisible();
    expect(reply().elements()).toHaveLength(0);
  });

  it("gives the holder the composer, with Hand back in the pane header", async () => {
    detail = makeDetail({ ...MINE, last_client_message_at: hoursAgo(0.5) });
    await renderAt();
    await expect.element(reply()).toBeVisible();
    await expect.element(reply()).toHaveAttribute("placeholder", "Write a reply…");
    await expect.element(pane().getByRole("button", { name: "Send" })).toBeDisabled();
    await expect
      .element(pane().getByText("Diana sees your Display name. Replies close in 23h."))
      .toBeVisible();
    // The header has it in the pane; the footer doesn't repeat it.
    await expect.element(pane().getByRole("button", { name: "Hand back to bot" })).toBeVisible();
    expect(footer()?.querySelector("[data-hand-back]")).toBeNull();
  });

  it("explains the closed window and offers the number to anyone but the holder", async () => {
    detail = makeDetail({ ...MARIAS, ...CLOSED });
    await renderAt();
    await expect.element(pane().getByText("Reply outside the bot")).toBeVisible();
    await expect
      .element(
        pane().getByText(
          "WhatsApp only lets the office reply within 24 hours of Diana’s last message (closed Sun, Oct 18, 5:00 PM). Call or text +13055550142.",
        ),
      )
      .toBeVisible();
    await expect.element(pane().getByRole("button", { name: "Copy number" })).toBeVisible();
    expect(pane().getByRole("button", { name: /Hand back/ }).elements()).toHaveLength(0);
    expect(reply().elements()).toHaveLength(0);
  });

  it("adds Hand back to the closed-window footer for the holder", async () => {
    detail = makeDetail({ ...MINE, ...CLOSED });
    await renderAt();
    await expect.element(pane().getByText("Reply outside the bot")).toBeVisible();
    expect(footer()?.querySelector("[data-hand-back]")?.textContent).toBe("Hand back to bot");
    expect(reply().elements()).toHaveLength(0);
  });

  it("calls an unnamed Guardian “this number”", async () => {
    detail = makeDetail({ guardian: null });
    await renderAt();
    await expect
      .element(page.getByText(/Take over to reply to this number yourself/))
      .toBeVisible();
  });
});

describe("Take over", () => {
  it("takes over in one request, with no confirm, and focuses the composer", async () => {
    let finish: (value: { data: ConversationDetail }) => void = () => undefined;
    network.post.mockImplementation(async (url: string) => {
      if (url.endsWith("/read")) return { data: detail };
      if (url === "/api/conversations/c1/takeover") {
        return new Promise((resolve) => {
          finish = resolve;
        });
      }
      throw new Error(`unexpected POST ${url}`);
    });
    await renderAt();
    await userEvent.click(takeOver());

    await expect.element(takeOver()).toHaveAttribute("aria-busy", "true");
    expect(page.getByRole("dialog").elements()).toHaveLength(0);
    finish({ data: makeDetail(MINE) });

    await expect.element(reply()).toHaveFocus();
    const takeovers = network.post.mock.calls.filter(([url]) => url.endsWith("/takeover"));
    expect(takeovers).toHaveLength(1);
  });

  it("says the window closed when refused, after refetching the chat", async () => {
    network.post.mockImplementation(async (url: string) => {
      if (url.endsWith("/read")) return { data: detail };
      detail = makeDetail(CLOSED);
      throw conflict();
    });
    await renderAt();
    await expect.element(takeOver()).toBeVisible();
    const before = detailFetches();
    await userEvent.click(takeOver());

    await expect
      .element(page.getByRole("alert").filter({ hasText: "Couldn’t take over" }))
      .toHaveTextContent("Couldn’t take over. Diana’s 24-hour window has closed.");
    expect(detailFetches()).toBeGreaterThan(before);
    await expect.element(pane().getByText("Reply outside the bot")).toBeVisible();
    await expect.element(pane().getByRole("button", { name: "Copy number" })).toHaveFocus();
  });

  it("says try again when refused with the window still open", async () => {
    network.post.mockImplementation(async (url: string) => {
      if (url.endsWith("/read")) return { data: detail };
      throw conflict();
    });
    await renderAt();
    await userEvent.click(takeOver());

    await expect
      .element(page.getByRole("alert").filter({ hasText: "Couldn’t take over" }))
      .toHaveTextContent("Couldn’t take over. Try again.");
    await expect.element(takeOver()).toBeEnabled();
    await expect.element(takeOver()).toHaveFocus();
  });
});

describe("Take over from a colleague", () => {
  const dialog = () => page.getByRole("dialog", { name: "Take over from Maria?" });

  beforeEach(() => {
    detail = makeDetail(MARIAS);
  });

  it("confirms first, and Leave it closes without a request", async () => {
    await renderAt();
    await userEvent.click(pane().getByRole("button", { name: "Take over from Maria" }));

    await expect
      .element(dialog().getByText("Maria can no longer reply here. Diana is told you’ve joined."))
      .toBeVisible();
    await userEvent.click(dialog().getByRole("button", { name: "Leave it with Maria" }));

    await expect.poll(() => dialog().elements()).toHaveLength(0);
    expect(network.post.mock.calls.filter(([url]) => url.endsWith("/transfer"))).toHaveLength(0);
  });

  it("sends the transfer on confirm and focuses the composer", async () => {
    network.post.mockImplementation(async (url: string) => {
      if (url.endsWith("/read")) return { data: detail };
      if (url === "/api/conversations/c1/transfer") return { data: makeDetail(MINE) };
      throw new Error(`unexpected POST ${url}`);
    });
    await renderAt();
    await userEvent.click(pane().getByRole("button", { name: "Take over from Maria" }));
    await userEvent.click(dialog().getByRole("button", { name: "Take over", exact: true }));

    await expect.element(reply()).toHaveFocus();
    expect(dialog().elements()).toHaveLength(0);
  });

  it("keeps the dialog open with an alert when refused, and refetches", async () => {
    network.post.mockImplementation(async (url: string) => {
      if (url.endsWith("/read")) return { data: detail };
      throw conflict();
    });
    await renderAt();
    await userEvent.click(pane().getByRole("button", { name: "Take over from Maria" }));
    const before = detailFetches();
    await userEvent.click(dialog().getByRole("button", { name: "Take over", exact: true }));

    await expect
      .element(dialog().getByRole("alert"))
      .toHaveTextContent("Couldn’t take over. The chat changed; check it and try again.");
    expect(detailFetches()).toBeGreaterThan(before);
  });
});

describe("Sending", () => {
  beforeEach(() => {
    detail = makeDetail(MINE);
  });

  it("sends on Enter with a Sending bubble, keeping focus, and Shift+Enter breaks the line", async () => {
    await renderAt();
    await userEvent.click(reply());
    await userEvent.keyboard("Hi Diana{Shift>}{Enter}{/Shift}Tomorrow?");
    expect(stream.send).not.toHaveBeenCalled();
    await userEvent.keyboard("{Enter}");

    expect(stream.send).toHaveBeenCalledExactlyOnceWith(
      "c1",
      "Hi Diana\nTomorrow?",
      expect.any(String),
    );
    await expect.element(reply()).toHaveValue("");
    await expect.element(reply()).toHaveFocus();
    const list = page.getByRole("list", { name: "Messages" });
    await expect.element(list.getByText(/Hi Diana/)).toBeVisible();
    await expect.element(list.getByText("Sending")).toBeVisible();
  });

  it("swaps the bubble for the stream’s copy when it lands", async () => {
    await renderAt();
    await userEvent.fill(reply(), "On my way");
    await userEvent.click(pane().getByRole("button", { name: "Send" }));
    const clientMessageId = stream.send.mock.calls[0][2] as string;

    const echoed: Message = {
      id: "server-1",
      author_kind: "admin",
      author: { id: ME.id, name: ME.name },
      body: "On my way",
      status: "sent",
      created_at: new Date().toISOString(),
      system_kind: null,
      error_code: null,
      reminder_child_names: null,
    };
    messages = [echoed];
    stream.handlers.onMessageCreated?.({
      conversation_id: "c1",
      message: echoed,
      client_message_id: clientMessageId,
    });

    const list = page.getByRole("list", { name: "Messages" });
    await expect.element(list.getByText("Sent", { exact: true })).toBeVisible();
    expect(list.getByText("On my way").elements()).toHaveLength(1);
    expect(list.getByText("Sending").elements()).toHaveLength(0);
  });

  it("rounds the reply box at 20px and lets it grow from 44px to 160px", async () => {
    await renderAt();
    await expect.element(reply()).toBeVisible();
    const style = getComputedStyle(reply().element());
    expect(style.borderRadius).toBe("20px");
    expect(style.minHeight).toBe("44px");
    expect(style.maxHeight).toBe("160px");
    expect(style.fontSize).toBe("15px");
  });

  it("disables the composer while the stream reconnects", async () => {
    stream.status = "disconnected";
    await renderAt();
    await expect.element(reply()).toHaveAttribute("aria-disabled", "true");
    await expect.element(reply()).toHaveAttribute("readonly");
    await expect.element(pane().getByRole("button", { name: "Send" })).toBeDisabled();
    await expect
      .element(page.getByRole("status").filter({ hasText: "Reconnecting" }))
      .toHaveTextContent("Reconnecting… Replies send once you’re back online.");
  });

  it("keeps focus in the reply box when the stream drops mid-draft", async () => {
    await renderAt();
    await userEvent.fill(reply(), "Half a thought");
    stream.status = "disconnected";
    // Any frame re-renders the thread, which reads the new status.
    stream.handlers.onError?.("Dropped", "other");

    await expect.element(reply()).toHaveAttribute("aria-disabled", "true");
    await expect.element(reply()).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(stream.send).not.toHaveBeenCalled();
    await expect.element(reply()).toHaveValue("Half a thought");
  });

  it("marks the send failed when the window closed, then shows the closed notice", async () => {
    await renderAt();
    await userEvent.fill(reply(), "Still there?");
    await userEvent.click(pane().getByRole("button", { name: "Send" }));
    detail = makeDetail({ ...MINE, ...CLOSED });
    stream.handlers.onError?.("The window has closed", "window_closed");

    const list = page.getByRole("list", { name: "Messages" });
    await expect.element(list.getByText("Not sent: the 24-hour window had closed.")).toBeVisible();
    await expect.element(pane().getByText("Reply outside the bot")).toBeVisible();
    await expect.element(pane().getByRole("button", { name: "Copy number" })).toHaveFocus();
  });

  it("shows any other stream error as an alert above the composer", async () => {
    await renderAt();
    await expect.element(reply()).toBeVisible();
    stream.handlers.onError?.("Message is too long", "invalid");

    await expect
      .element(page.getByRole("alert").filter({ hasText: "Message is too long" }))
      .toBeVisible();
  });
});

describe("Hand back", () => {
  const handBack = () => pane().getByRole("button", { name: "Hand back to bot" });
  const deletes = () => network.delete.mock.calls;

  beforeEach(() => {
    // Query updates are batched on setTimeout, which the fake clock holds.
    notifyManager.setScheduler(queueMicrotask);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    detail = makeDetail({ ...MINE, flag_reason: "question", flagged_at: hoursAgo(1) });
    network.delete.mockImplementation(async () => {
      detail = makeDetail();
      return { data: detail };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    notifyManager.setScheduler((callback) => setTimeout(callback, 0));
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("shows the bot at once, clears the flag, and offers Undo", async () => {
    await renderAt();
    await userEvent.click(handBack());

    await expect.element(takeOver()).toHaveFocus();
    await expect.element(pane().getByText("Bot", { exact: true })).toBeVisible();
    expect(document.querySelector('[data-slot="attention-card"]')).toBeNull();
    await expect
      .element(page.getByText("Handed back. The bot is answering Diana."))
      .toBeVisible();
    await expect.element(undo()).toBeVisible();
    expect(handBack().elements()).toHaveLength(0);
    expect(deletes()).toHaveLength(0);
  });

  it("lets Take over inside the Undo window cancel the release", async () => {
    network.post.mockImplementation(async (url: string) => {
      if (url.endsWith("/read")) return { data: detail };
      // The server still has me as holder; claiming again is a no-op.
      if (url === "/api/conversations/c1/takeover") return { data: detail };
      throw new Error(`unexpected POST ${url}`);
    });
    await renderAt();
    await userEvent.click(handBack());
    await expect.element(takeOver()).toHaveFocus();
    await userEvent.keyboard("{Enter}");

    await expect.element(reply()).toHaveFocus();
    expect(deletes()).toHaveLength(0);
    vi.advanceTimersByTime(LONG_AFTER_WINDOW_MS);
    expect(deletes()).toHaveLength(0);
    await expect.element(pane().getByText("Taken over by you")).toBeVisible();
  });

  describe("a second Hand back after a Take over", () => {
    const SECOND_AT_MS = 4000;
    // Oldest toast first in the DOM: A's Undo, then B's (once A's toast
    // has timed out, B's is the only one).
    const undoOf = (act: "A" | "B") => (act === "A" ? undo().first() : undo().last());

    beforeEach(() => {
      network.post.mockImplementation(async (url: string) => {
        if (url.endsWith("/read")) return { data: detail };
        // The server still has me as holder; claiming again is a no-op.
        if (url === "/api/conversations/c1/takeover") return { data: detail };
        throw new Error(`unexpected POST ${url}`);
      });
    });

    async function handBackTwice(): Promise<void> {
      await renderAt();
      await userEvent.click(handBack());
      await expect.element(takeOver()).toHaveFocus();
      await userEvent.keyboard("{Enter}");
      await expect.element(reply()).toHaveFocus();
      vi.advanceTimersByTime(SECOND_AT_MS);
      await userEvent.click(handBack());
      await expect.element(takeOver()).toHaveFocus();
      expect(undo().elements()).toHaveLength(2);
    }

    it("never lets the first act send, so the second’s Undo still holds", async () => {
      await handBackTwice();
      // A's window ends; it was superseded, so nothing goes out.
      vi.advanceTimersByTime(UNDO_WINDOW_MS - SECOND_AT_MS);
      expect(deletes()).toHaveLength(0);

      await userEvent.click(undoOf("B"));
      await expect.element(reply()).toHaveFocus();
      vi.advanceTimersByTime(LONG_AFTER_WINDOW_MS);
      expect(deletes()).toHaveLength(0);
      await expect.element(pane().getByText("Taken over by you")).toBeVisible();
    });

    it("ignores the first act’s stale Undo, and the second still sends", async () => {
      await handBackTwice();
      await userEvent.click(undoOf("A"));

      // Checked at once: a polling wait advances the fake clock.
      expect(takeOver().elements()).toHaveLength(1);
      expect(reply().elements()).toHaveLength(0);
      vi.advanceTimersByTime(UNDO_WINDOW_MS);
      expect(deletes()).toEqual([["/api/conversations/c1/takeover", {}]]);
    });
  });

  it("keeps a reactivation request flagged", async () => {
    detail = makeDetail({ ...MINE, flag_reason: "reactivation_request", flagged_at: hoursAgo(1) });
    await renderAt();
    await userEvent.click(handBack());

    await expect.element(takeOver()).toBeVisible();
    expect(document.querySelector('[data-slot="attention-card"]')).not.toBeNull();
    expect(deletes()).toHaveLength(0);
  });

  it("sends the release only once the Undo window ends", async () => {
    await renderAt();
    await userEvent.click(handBack());
    await expect.element(undo()).toBeVisible();

    vi.advanceTimersByTime(UNDO_WINDOW_MS - 1);
    expect(deletes()).toHaveLength(0);
    const before = detailFetches();
    vi.advanceTimersByTime(1);

    expect(deletes()).toEqual([["/api/conversations/c1/takeover", {}]]);
    await expect.poll(detailFetches).toBeGreaterThan(before);
    vi.advanceTimersByTime(LONG_AFTER_WINDOW_MS);
    expect(deletes()).toHaveLength(1);
  });

  it("puts everything back on Undo and never sends", async () => {
    await renderAt();
    await userEvent.click(reply());
    await userEvent.click(handBack());
    await userEvent.click(undo());

    await expect.element(reply()).toHaveFocus();
    await expect.element(pane().getByText("Taken over by you")).toBeVisible();
    expect(document.querySelector('[data-slot="attention-card"]')).not.toBeNull();
    vi.advanceTimersByTime(LONG_AFTER_WINDOW_MS);
    expect(deletes()).toHaveLength(0);
  });

  it("sends at once with keepalive when the page hides", async () => {
    await renderAt();
    await userEvent.click(handBack());
    await expect.element(undo()).toBeVisible();

    window.dispatchEvent(new PageTransitionEvent("pagehide"));

    expect(deletes()).toEqual([
      [
        "/api/conversations/c1/takeover",
        { adapter: "fetch", fetchOptions: { keepalive: true } },
      ],
    ]);
    vi.advanceTimersByTime(LONG_AFTER_WINDOW_MS);
    expect(deletes()).toHaveLength(1);
  });

  it("says so and refetches when the release fails", async () => {
    network.delete.mockRejectedValue(new Error("Network Error"));
    await renderAt();
    await userEvent.click(handBack());
    await expect.element(undo()).toBeVisible();
    const before = detailFetches();

    vi.advanceTimersByTime(UNDO_WINDOW_MS);

    await expect
      .element(page.getByRole("alert").filter({ hasText: "Couldn’t hand back" }))
      .toHaveTextContent("Couldn’t hand back the chat with Diana. Try again.");
    await expect.poll(detailFetches).toBeGreaterThan(before);
    await expect.element(handBack()).toBeVisible();
  });

  it("keeps showing the bot when the chat refetches inside the Undo window", async () => {
    const queryClient = await renderAt();
    await userEvent.click(handBack());
    await expect.element(undo()).toBeVisible();

    // The server still says it's mine (the release hasn't gone yet); the
    // language change shows when the refetch has rendered.
    detail = { ...detail, language: "es" };
    await queryClient.refetchQueries({ queryKey: ["conversations", "detail", "c1"], exact: true });

    await expect
      .element(pane().getByRole("combobox", { name: "Guardian language" }))
      .toHaveTextContent("Spanish");
    // Checked at once: a polling wait advances the fake clock to the commit.
    expect(deletes()).toHaveLength(0);
    expect(takeOver().elements()).toHaveLength(1);
    expect(handBack().elements()).toHaveLength(0);
    expect(reply().elements()).toHaveLength(0);
  });

  it("puts Hand back to bot in the closed-window footer, focusing Copy number after", async () => {
    detail = makeDetail({ ...MINE, ...CLOSED });
    await renderAt();
    const link = footer()?.querySelector<HTMLElement>("[data-hand-back]");
    link?.click();

    await expect.element(pane().getByRole("button", { name: "Copy number" })).toHaveFocus();
    expect(footer()?.querySelector("[data-hand-back]")).toBeNull();
    expect(deletes()).toHaveLength(0);
  });
});

describe("Phone layout", () => {
  const dialog = () => page.getByRole("dialog", { name: "Chat with Diana Gómez" });

  beforeEach(async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
  });

  it("puts Hand back beside the composer hint", async () => {
    detail = makeDetail(MINE);
    await renderAt();
    await expect.element(dialog().getByRole("textbox", { name: "Reply" })).toBeVisible();
    await expect.element(dialog().getByRole("button", { name: "Hand back", exact: true })).toBeVisible();
    expect(dialog().getByRole("button", { name: "Hand back to bot" }).elements()).toHaveLength(0);
  });

  it("stacks Copy number full width under the notice, the number selectable", async () => {
    detail = makeDetail(CLOSED);
    await renderAt();
    const button = dialog().getByRole("button", { name: "Copy number" });
    await expect.element(button).toBeVisible();
    const slot = dialog().element().querySelector<HTMLElement>('[data-slot="thread-footer"]');
    expect(button.element().getBoundingClientRect().width).toBe(slot?.getBoundingClientRect().width);
    const number = [...(slot?.querySelectorAll("span") ?? [])].find(
      (span) => span.textContent === "+13055550142",
    );
    expect(number && getComputedStyle(number).userSelect).toBe("all");
  });

  it("stacks Take over full width under the notice", async () => {
    await renderAt();
    const button = dialog().getByRole("button", { name: "Take over", exact: true });
    await expect.element(button).toBeVisible();
    const slot = dialog().element().querySelector<HTMLElement>('[data-slot="thread-footer"]');
    expect(button.element().getBoundingClientRect().width).toBe(slot?.getBoundingClientRect().width);
    expect(button.element().getBoundingClientRect().height).toBe(44);
  });
});

describe("Copy number", () => {
  beforeEach(() => {
    detail = makeDetail(CLOSED);
  });

  it("puts Copy number beside the notice from 448px", async () => {
    await renderAt();
    const button = pane().getByRole("button", { name: "Copy number" });
    await expect.element(button).toBeVisible();
    const notice = pane().getByText("Reply outside the bot").element();
    expect(button.element().getBoundingClientRect().left).toBeGreaterThan(
      notice.getBoundingClientRect().right,
    );
  });

  it("copies the number and says so", async () => {
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    await renderAt();
    await userEvent.click(pane().getByRole("button", { name: "Copy number" }));

    expect(write).toHaveBeenCalledWith("+13055550142");
    await expect.element(page.getByText("Number copied")).toBeVisible();
  });

  it("says to copy it by hand when the clipboard refuses", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    await renderAt();
    await userEvent.click(pane().getByRole("button", { name: "Copy number" }));

    await expect
      .element(page.getByRole("alert").filter({ hasText: "Couldn’t copy" }))
      .toHaveTextContent("Couldn’t copy the number. Select it and copy it by hand.");
  });
});
