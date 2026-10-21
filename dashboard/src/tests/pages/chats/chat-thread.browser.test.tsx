import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { App } from "@/App";
import type { CountsRead } from "@/components/kit/shell/nav";
import type { UseConversationStreamHandlers } from "@/hooks/use-conversation-stream/useConversationStream";
import type {
  ConversationDetail,
  Message,
} from "@/lib/queries/conversations";
import type { Page } from "@/lib/queries/page";
import { useAuthStore } from "@/stores/authStore";
import { createTestQueryClient, renderWithProviders } from "@/test/render-with-providers";

const SPLIT_VIEWPORT = { width: 1280, height: 800 };
const PHONE_VIEWPORT = { width: 375, height: 760 };
const HOUR_MS = 3_600_000;

const network = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));
const stream = vi.hoisted(() => ({
  handlers: {} as UseConversationStreamHandlers,
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
    return { status: "connected", error: null, errorCode: null, send: vi.fn() };
  },
}));

const ME = { id: "u-1", email: "rita@example.com", role: "admin", name: "Rita Alves" };
const COUNTS: CountsRead = {
  needs_attention: 0,
  time_off_pending: 0,
  children_awaiting_evaluation: 0,
  bookings_to_sort_out: 0,
  children_needing_tutor: 0,
  unread_chats: 1,
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

let sequence = 0;

function makeMessage(overrides: Partial<Message> = {}): Message {
  sequence += 1;
  return {
    id: `m${sequence}`,
    author_kind: "client",
    author: null,
    body: `Message ${sequence}`,
    status: "received",
    created_at: new Date(Date.now() - 60_000).toISOString(),
    system_kind: null,
    error_code: null,
    reminder_child_names: null,
    ...overrides,
  };
}

// Reading order in, newest-first page out, as the API sends it.
function toPage(messages: Message[], total = messages.length): Page<Message> {
  return { items: [...messages].reverse(), total, page: 1, page_size: 20 };
}

type Server = {
  detail: () => Promise<ConversationDetail>;
  messages: (before: string | undefined) => Promise<Page<Message>>;
};

let server: Server;

function serve(
  detail: ConversationDetail,
  messages: Message[] = [],
): void {
  server = {
    detail: async () => detail,
    messages: async () => toPage(messages),
  };
}

function wireNetwork(): void {
  network.get.mockImplementation(
    async (url: string, config?: { params?: { before?: string } }) => {
      if (url === "/api/me") return { data: ME };
      if (url === "/api/counts") return { data: COUNTS };
      if (url === "/api/conversations") {
        return { data: { items: [], total: 0, page: 1, page_size: 20 } };
      }
      if (url.endsWith("/messages")) {
        return { data: await server.messages(config?.params?.before) };
      }
      return { data: await server.detail() };
    },
  );
  network.post.mockImplementation(async (url: string) => {
    if (url.endsWith("/read")) return { data: await server.detail() };
    throw new Error(`unexpected POST ${url}`);
  });
}

async function renderAt(path: string, queryClient = createTestQueryClient()) {
  window.history.pushState({}, "", path);
  useAuthStore.setState({ status: "authenticated", role: "admin" });
  await renderWithProviders(<App />, queryClient);
  return queryClient;
}

beforeEach(async () => {
  await page.viewport(SPLIT_VIEWPORT.width, SPLIT_VIEWPORT.height);
  vi.clearAllMocks();
  // The thread logs failed requests; the tests cause them on purpose.
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  stream.handlers = {};
  wireNetwork();
  serve(makeDetail());
});

const pane = () => page.getByRole("region", { name: "Chat with Diana Gómez" });

describe("Chat thread containers", () => {
  it("opens a deep-linked chat in the pane from 1152px", async () => {
    await renderAt("/chats/c1");
    await expect.element(pane()).toBeVisible();
    await expect
      .element(pane().getByRole("heading", { level: 2, name: /Diana Gómez/ }))
      .toBeVisible();
    expect(page.getByRole("dialog").elements()).toHaveLength(0);
  });

  it("opens below 1152px as a page that goes back to the list with the filters kept", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    await renderAt("/chats/c1?q=diana&unread=1");
    const dialog = page.getByRole("dialog", { name: "Chat with Diana Gómez" });
    await expect.element(dialog).toBeVisible();

    await userEvent.click(dialog.getByRole("button", { name: "Chats" }));
    expect(window.location.pathname).toBe("/chats");
    expect(window.location.search).toBe("?q=diana&unread=1");
  });
});

describe("Opening a chat", () => {
  it("marks it read and refreshes the list and counts", async () => {
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await renderAt("/chats/c1", queryClient);
    await expect.element(pane()).toBeVisible();

    await vi.waitFor(() =>
      expect(network.post).toHaveBeenCalledWith("/api/conversations/c1/read"),
    );
    await vi.waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["conversations", "list"] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["counts"] });
    });
  });
});

describe("Chat header", () => {
  it("links the Guardian name to the family and shows the number and language", async () => {
    await renderAt("/chats/c1");
    const link = pane().getByRole("link", { name: /^Diana Gómez\s?: open family$/ });
    await expect.element(link).toHaveAttribute("href", "/families/g1?guardian=g1");
    await expect.element(pane().getByText("+13055550142")).toBeVisible();
    await expect
      .element(pane().getByRole("combobox", { name: "Guardian language" }))
      .toHaveTextContent("English");
  });

  it("titles an unnamed chat with its number, as plain text", async () => {
    serve(makeDetail({ guardian: null, language: null }));
    await renderAt("/chats/c1");
    const unnamed = page.getByRole("region", { name: "Chat with +13055550142" });
    await expect
      .element(unnamed.getByRole("heading", { level: 2, name: "+13055550142" }))
      .toBeVisible();
    expect(unnamed.getByRole("link").elements()).toHaveLength(0);
    await expect
      .element(unnamed.getByRole("combobox", { name: "Guardian language" }))
      .toHaveTextContent("Language not detected");
  });

  it("changes the language", async () => {
    network.patch.mockResolvedValue({ data: makeDetail({ language: "es" }) });
    await renderAt("/chats/c1");
    await userEvent.click(pane().getByRole("combobox", { name: "Guardian language" }));
    await userEvent.click(page.getByRole("option", { name: "Spanish" }));

    expect(network.patch).toHaveBeenCalledWith("/api/conversations/c1", {
      language: "es",
    });
    await expect
      .element(pane().getByRole("combobox", { name: "Guardian language" }))
      .toHaveTextContent("Spanish");
    expect(page.getByRole("alert").elements()).toHaveLength(0);
  });

  it("reverts the language and says so when the change fails", async () => {
    network.patch.mockRejectedValue(new Error("down"));
    await renderAt("/chats/c1");
    await userEvent.click(pane().getByRole("combobox", { name: "Guardian language" }));
    await userEvent.click(page.getByRole("option", { name: "Spanish" }));

    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Couldn’t change the language. Try again.");
    await expect
      .element(pane().getByRole("combobox", { name: "Guardian language" }))
      .toHaveTextContent("English");
  });
});

describe("Chat badges", () => {
  it("shows Intake in progress, the Bot and the takeover cue while the window is open", async () => {
    serve(makeDetail({ intake_in_progress: true }));
    await renderAt("/chats/c1");
    await expect.element(pane().getByText("Intake in progress")).toBeVisible();
    await expect.element(pane().getByText("Bot", { exact: true })).toBeVisible();
    await expect.element(pane().getByText(/Takeover closes in/)).toBeVisible();
  });

  it("says Taken over by you, with the replies cue, when I hold the chat", async () => {
    serve(
      makeDetail({
        status: "human",
        taken_over_by: { id: ME.id, name: ME.name },
      }),
    );
    await renderAt("/chats/c1");
    await expect.element(pane().getByText("Taken over by you")).toBeVisible();
    // The footer hint says it too; this is the header cue.
    await expect.element(pane().getByText(/^Replies close in/)).toBeVisible();
  });

  it("names a colleague by first name and drops the cue once the window closed", async () => {
    serve(
      makeDetail({
        status: "human",
        taken_over_by: { id: "u-2", name: "Maria Silva" },
        is_window_open: false,
        last_client_message_at: hoursAgo(30),
      }),
    );
    await renderAt("/chats/c1");
    await expect.element(pane().getByText("Taken over by Maria")).toBeVisible();
    // The footer says "Reply outside the bot"; the header has no cue.
    expect(pane().getByText(/close in/).elements()).toHaveLength(0);
    expect(pane().getByText("Intake in progress").elements()).toHaveLength(0);
  });
});

const messageList = () => page.getByRole("list", { name: "Messages" });
const itemOf = (id: string) =>
  document.querySelector<HTMLElement>(`[data-message="${id}"]`);

describe("Messages", () => {
  it("groups messages by day in the business zone", async () => {
    serve(makeDetail(), [
      makeMessage({ body: "Back in October", created_at: "2026-10-11T21:00:00Z" }),
      makeMessage({ body: "From yesterday", created_at: hoursAgo(24) }),
      makeMessage({ body: "From today", created_at: hoursAgo(0.01) }),
    ]);
    await renderAt("/chats/c1");
    await expect.element(messageList().getByText("From today")).toBeVisible();
    const separators = messageList()
      .getByRole("listitem")
      .elements()
      .filter((item) => !item.hasAttribute("data-message"))
      .map((item) => item.textContent);
    expect(separators).toEqual(["Sunday, Oct 11", "Yesterday", "Today"]);
  });

  it("puts the Guardian on the left and labels bot and office replies by author", async () => {
    serve(makeDetail(), [
      makeMessage({ id: "g", body: "Can we move Thursday?" }),
      makeMessage({ id: "b", author_kind: "bot", body: "Sure!", status: "delivered" }),
      makeMessage({
        id: "me",
        author_kind: "admin",
        author: { id: ME.id, name: ME.name },
        body: "Done",
        status: "sent",
      }),
      makeMessage({
        id: "maria",
        author_kind: "admin",
        author: { id: "u-2", name: "Maria Silva" },
        body: "Hi!",
        status: "delivered",
      }),
    ]);
    await renderAt("/chats/c1");
    await expect.element(messageList().getByText("Hi!")).toBeVisible();

    expect(itemOf("g")?.className).toContain("items-start");
    expect(itemOf("g")?.textContent).toContain("Guardian: Can we move Thursday?");
    expect(itemOf("b")?.className).toContain("items-end");
    expect(itemOf("b")?.textContent).toContain("Bot: Sure!");
    expect(itemOf("me")?.textContent).toContain("You: Done");
    expect(itemOf("maria")?.textContent).toContain("Maria: Hi!");
  });

  it("shows each office delivery mark and none on bot replies that went out", async () => {
    const office = (id: string, status: Message["status"]) =>
      makeMessage({
        id,
        author_kind: "admin",
        author: { id: ME.id, name: ME.name },
        status,
      });
    serve(makeDetail(), [
      office("queued", "queued"),
      office("sent", "sent"),
      office("delivered", "delivered"),
      office("read", "read"),
      office("failed", "failed"),
      makeMessage({ id: "bot", author_kind: "bot", status: "delivered" }),
    ]);
    await renderAt("/chats/c1");
    await expect.element(messageList()).toBeVisible();

    expect(itemOf("queued")?.textContent).toContain("Sending");
    expect(itemOf("sent")?.textContent).toContain("Sent");
    expect(itemOf("delivered")?.textContent).toContain("Delivered");
    expect(itemOf("read")?.textContent).toContain("Read");
    expect(itemOf("failed")?.textContent).toContain("Not sent");
    expect(itemOf("failed")?.textContent).toContain(
      "Not sent: WhatsApp didn’t accept it.",
    );
    expect(itemOf("bot")?.textContent).not.toMatch(/Sent|Delivered|Read/);
  });

  it("marks a failed bot reply with the error line and never offers Retry", async () => {
    serve(makeDetail(), [
      makeMessage({
        id: "bot",
        author_kind: "bot",
        status: "failed",
        error_code: "63024",
      }),
    ]);
    await renderAt("/chats/c1");
    await expect
      .element(messageList().getByText("Not sent: this number can’t get WhatsApp messages."))
      .toBeVisible();
    expect(itemOf("bot")?.textContent).toContain("Not sent");
    expect(messageList().getByRole("button", { name: "Retry" }).elements()).toHaveLength(0);
  });

  it("shows the handoff note and the number change note as Staff-only, never failed", async () => {
    serve(makeDetail(), [
      makeMessage({
        id: "handoff",
        author_kind: "system",
        system_kind: "handoff_note",
        body: "Wants Thursday at 4.",
        status: "failed",
      }),
      makeMessage({
        id: "number",
        author_kind: "system",
        system_kind: "number_change_note",
        body: "Number changed from +1 305 555 0100.",
      }),
    ]);
    await renderAt("/chats/c1");
    await expect.element(messageList().getByText("Wants Thursday at 4.")).toBeVisible();

    const handoff = itemOf("handoff")?.textContent ?? "";
    expect(handoff).toContain("Bot’s handoff note");
    expect(handoff).toContain("Only the office sees this.");
    expect(handoff).not.toContain("“");
    expect(handoff).not.toContain("Not sent");
    expect(itemOf("number")?.textContent).toContain("Office note");
    expect(itemOf("number")?.textContent).toContain("Only the office sees this.");
  });

  it("quotes a booking reminder sent to the Guardian, with its Children", async () => {
    serve(makeDetail(), [
      makeMessage({
        id: "reminder",
        author_kind: "system",
        system_kind: "booking_reminder",
        body: "Reply to book this week.",
        status: "delivered",
        reminder_child_names: ["Ana", "Leo"],
      }),
    ]);
    await renderAt("/chats/c1");
    await expect.element(messageList().getByText(/Reply to book this week/)).toBeVisible();
    expect(itemOf("reminder")?.textContent).toContain("Booking reminder for Ana and Leo");
    expect(itemOf("reminder")?.textContent).toContain(
      "Sent to the Guardian: “Reply to book this week.”",
    );
  });

  it("renders message bodies as text, never HTML", async () => {
    serve(makeDetail(), [makeMessage({ id: "html", body: "<b>bold</b>" })]);
    await renderAt("/chats/c1");
    await expect.element(messageList().getByText("<b>bold</b>")).toBeVisible();
    expect(itemOf("html")?.querySelector("b")).toBeNull();
  });
});

describe("Notice retry", () => {
  const failedNotice = () =>
    makeMessage({
      id: "notice",
      author_kind: "system",
      system_kind: "takeover_notice",
      body: "Rita from the office joined the chat.",
      status: "failed",
      error_code: "window_closed",
    });

  it("retries a failed takeover notice and swaps it in place", async () => {
    serve(makeDetail(), [failedNotice()]);
    network.post.mockImplementation(async (url: string) => {
      if (url.endsWith("/read")) return { data: makeDetail() };
      return { data: { ...failedNotice(), id: "notice", status: "sent", error_code: null } };
    });
    await renderAt("/chats/c1");
    await userEvent.click(messageList().getByRole("button", { name: "Retry" }));

    expect(network.post).toHaveBeenCalledWith(
      "/api/conversations/c1/messages/notice/retry",
    );
    await vi.waitFor(() =>
      expect(itemOf("notice")?.textContent).not.toContain("Not sent"),
    );
  });

  it("refetches and says so when the retry is refused", async () => {
    serve(makeDetail(), [failedNotice()]);
    network.post.mockImplementation(async (url: string) => {
      if (url.endsWith("/read")) return { data: makeDetail() };
      throw Object.assign(new Error("conflict"), {
        isAxiosError: true,
        response: { status: 409, data: {} },
      });
    });
    await renderAt("/chats/c1");
    const detailCalls = () =>
      network.get.mock.calls.filter(([url]) => url === "/api/conversations/c1").length;
    const before = detailCalls();
    await userEvent.click(messageList().getByRole("button", { name: "Retry" }));

    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Couldn’t send it again. Check the chat and try again.");
    await vi.waitFor(() => expect(detailCalls()).toBeGreaterThan(before));
  });

  it("offers no Retry once the window has closed", async () => {
    serve(makeDetail({ is_window_open: false }), [failedNotice()]);
    await renderAt("/chats/c1");
    await expect.element(messageList().getByText(/joined the chat/)).toBeVisible();
    expect(itemOf("notice")?.textContent).toContain("Not sent");
    expect(messageList().getByRole("button", { name: "Retry" }).elements()).toHaveLength(0);
  });
});

describe("Older messages", () => {
  const older = [
    makeMessage({ id: "old-1", body: "First ever", created_at: "2026-10-11T20:00:00Z" }),
    makeMessage({ id: "old-2", body: "Second ever", created_at: "2026-10-11T20:05:00Z" }),
  ];
  const newest = [
    makeMessage({ id: "new-1", body: "Recent one", created_at: hoursAgo(2) }),
  ];

  function serveTwoPages(failOlderTimes = 0): void {
    let failuresLeft = failOlderTimes;
    server = {
      detail: async () => makeDetail(),
      messages: async (before) => {
        if (before === undefined) return toPage(newest, 3);
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          throw new Error("down");
        }
        return toPage(older, 3);
      },
    };
  }

  it("loads an older page before the oldest message on screen", async () => {
    serveTwoPages();
    await renderAt("/chats/c1");
    await userEvent.click(page.getByRole("button", { name: "Load older messages" }));

    await expect.element(messageList().getByText("First ever")).toBeVisible();
    expect(network.get).toHaveBeenCalledWith("/api/conversations/c1/messages", {
      params: { page_size: 20, before: newest[0].created_at },
    });
    const bodies = messageList()
      .getByRole("listitem")
      .elements()
      .filter((item) => item.hasAttribute("data-message"))
      .map((item) => item.getAttribute("data-message"));
    expect(bodies).toEqual(["old-1", "old-2", "new-1"]);
    expect(page.getByRole("button", { name: "Load older messages" }).elements()).toHaveLength(0);
  });

  it("offers its own retry when an older page fails", async () => {
    serveTwoPages(1);
    await renderAt("/chats/c1");
    await userEvent.click(page.getByRole("button", { name: "Load older messages" }));

    const alert = page.getByRole("alert");
    await expect
      .element(alert)
      .toHaveTextContent("Couldn’t load older messages. Check your connection.");
    await expect.element(messageList().getByText("Recent one")).toBeVisible();

    await userEvent.click(alert.getByRole("button", { name: "Try again" }));
    await expect.element(messageList().getByText("First ever")).toBeVisible();
  });
});

describe("Live updates", () => {
  it("adds a new message from the stream and refreshes the detail", async () => {
    const first = makeMessage({ id: "a", body: "Hello" });
    const messages = [first];
    server = {
      detail: async () => makeDetail(),
      messages: async () => toPage(messages),
    };
    await renderAt("/chats/c1");
    await expect.element(messageList().getByText("Hello")).toBeVisible();
    const detailCalls = () =>
      network.get.mock.calls.filter(([url]) => url === "/api/conversations/c1").length;
    const before = detailCalls();

    const arrived = makeMessage({ id: "b", body: "Are you there?", created_at: new Date().toISOString() });
    messages.push(arrived);
    stream.handlers.onMessageCreated?.({ conversation_id: "c1", message: arrived });

    await expect.element(messageList().getByText("Are you there?")).toBeVisible();
    expect(itemOf("b")?.className).toContain("kit-rise");
    expect(itemOf("a")?.className).not.toContain("kit-rise");
    await vi.waitFor(() => expect(detailCalls()).toBeGreaterThan(before));
  });

  it("ignores frames for other chats", async () => {
    serve(makeDetail(), [makeMessage({ id: "a", body: "Hello" })]);
    await renderAt("/chats/c1");
    await expect.element(messageList().getByText("Hello")).toBeVisible();
    const callsBefore = network.get.mock.calls.length;

    stream.handlers.onMessageCreated?.({ conversation_id: "other", message: makeMessage() });
    stream.handlers.onConversationUpdated?.({ ...makeDetail({ id: "other" }), last_message_preview: "", unread: false });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(network.get.mock.calls.length).toBe(callsBefore);
  });

  it("swaps a delivery status in place", async () => {
    const reply = makeMessage({
      id: "r",
      author_kind: "admin",
      author: { id: ME.id, name: ME.name },
      body: "On it",
      status: "sent",
    });
    serve(makeDetail(), [reply]);
    await renderAt("/chats/c1");
    await expect.element(messageList().getByText("On it")).toBeVisible();
    const node = itemOf("r");

    stream.handlers.onMessageUpdated?.({
      conversation_id: "c1",
      message: { ...reply, status: "delivered" },
    });

    await vi.waitFor(() => expect(itemOf("r")?.textContent).toContain("Delivered"));
    expect(itemOf("r")).toBe(node);
  });

  it("refetches the detail when the chat changes", async () => {
    let detail = makeDetail();
    server = { detail: async () => detail, messages: async () => toPage([]) };
    await renderAt("/chats/c1");
    await expect.element(pane().getByText("Bot", { exact: true })).toBeVisible();

    detail = makeDetail({ status: "human", taken_over_by: { id: "u-2", name: "Maria Silva" } });
    stream.handlers.onConversationUpdated?.({ ...detail, last_message_preview: "", unread: false });

    await expect.element(pane().getByText("Taken over by Maria")).toBeVisible();
  });
});

describe("Thread states", () => {
  it("shows a header and bubble skeleton while loading, with no footer", async () => {
    server = {
      detail: () => new Promise(() => undefined),
      messages: () => new Promise(() => undefined),
    };
    await renderAt("/chats/c1");
    await expect.element(page.getByRole("status", { name: "Loading chat" })).toBeVisible();
    expect(document.querySelector('[data-slot="thread-footer"]')).toBeNull();
  });

  it("says the chat couldn’t load, and tries again", async () => {
    let isDown = true;
    server = {
      detail: async () => {
        if (isDown) {
          throw Object.assign(new Error("Not found"), {
            isAxiosError: true,
            response: { status: 404, data: {} },
          });
        }
        return makeDetail();
      },
      messages: async () => toPage([]),
    };
    await renderAt("/chats/c1");
    const alert = page.getByRole("alert");
    await expect.element(alert).toHaveTextContent("Couldn’t load this chat");
    await expect.element(alert).toHaveTextContent("Check your connection and try again.");
    expect(document.querySelector('[data-slot="thread-footer"]')).toBeNull();

    isDown = false;
    await userEvent.click(alert.getByRole("button", { name: "Try again" }));
    await expect.element(pane()).toBeVisible();
  });

  it("says there are no messages yet and keeps the footer", async () => {
    await renderAt("/chats/c1");
    await expect.element(pane().getByText("No messages yet")).toBeVisible();
    await expect
      .element(pane().getByText("Messages show here as soon as the Guardian writes."))
      .toBeVisible();
    expect(document.querySelector('[data-slot="thread-footer"]')).not.toBeNull();
  });
});

describe("Thread slots", () => {
  it("puts the footer at the bottom of the pane and the attention card under the header", async () => {
    serve(makeDetail({ flag_reason: "question", flagged_at: hoursAgo(1) }));
    await renderAt("/chats/c1");
    await expect.element(pane()).toBeVisible();
    const section = pane().element();
    const footer = section.querySelector('[data-slot="thread-footer"]');
    const card = section.querySelector('[data-slot="attention-card"]');
    expect(footer?.getAttribute("data-container")).toBe("pane");
    expect(card?.textContent).toContain("Has a question");
    expect(card?.getAttribute("data-compact")).toBe("false");
    expect(section.lastElementChild?.contains(footer ?? null)).toBe(true);
  });

  it("leaves the attention card out when nothing needs attention", async () => {
    await renderAt("/chats/c1");
    await expect.element(pane()).toBeVisible();
    expect(document.querySelector('[data-slot="attention-card"]')).toBeNull();
  });

  it("pins the compact card in the overlay header and the footer in its footer", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    serve(makeDetail({ flag_reason: "stuck", flagged_at: hoursAgo(1) }));
    await renderAt("/chats/c1");
    const dialog = page.getByRole("dialog", { name: "Chat with Diana Gómez" });
    await expect.element(dialog.getByText("Bot got stuck")).toBeVisible();
    const card = dialog.element().querySelector('[data-slot="attention-card"]');
    expect(card?.getAttribute("data-compact")).toBe("true");
    expect(card?.closest(".sticky")).not.toBeNull();
    const footer = dialog.element().querySelector('[data-slot="thread-footer"]');
    expect(footer?.getAttribute("data-container")).toBe("overlay");
  });

  it("doesn’t move focus into the pane when a chat opens", async () => {
    await renderAt("/chats/c1");
    await expect.element(pane()).toBeVisible();
    expect(pane().element().contains(document.activeElement)).toBe(false);
  });
});

describe("Scrolling", () => {
  function distanceFromBottom(element: HTMLElement): number {
    return element.scrollHeight - element.scrollTop - element.clientHeight;
  }

  it("opens on the newest message and follows a new one while at the bottom", async () => {
    const messages = Array.from({ length: 30 }, (_, index) =>
      makeMessage({ body: `Line ${index}`, created_at: hoursAgo(3 - index / 100) }),
    );
    server = { detail: async () => makeDetail(), messages: async () => toPage(messages) };
    await renderAt("/chats/c1");
    await expect.element(messageList().getByText(/Line 29$/)).toBeVisible();
    const scroller = messageList().element().closest<HTMLElement>(".overflow-y-auto");
    expect(scroller).not.toBeNull();
    expect(scroller!.scrollHeight).toBeGreaterThan(scroller!.clientHeight);
    expect(distanceFromBottom(scroller!)).toBeLessThanOrEqual(1);

    const arrived = makeMessage({ body: "Newest", created_at: new Date().toISOString() });
    messages.push(arrived);
    stream.handlers.onMessageCreated?.({ conversation_id: "c1", message: arrived });
    await expect.element(messageList().getByText("Newest")).toBeVisible();
    expect(distanceFromBottom(scroller!)).toBeLessThanOrEqual(1);
  });
});

describe("Phone layout", () => {
  it("fits 375px without sideways scrolling, badges wrapping", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    serve(
      makeDetail({
        intake_in_progress: true,
        status: "human",
        taken_over_by: { id: "u-2", name: "Maria Silva" },
        guardian: { id: "g1", name: "Diana Gómez de la Fuente Albuquerque" },
      }),
      [makeMessage({ body: "A".repeat(200) }), makeMessage({ author_kind: "bot", body: "Sure, which day works best for you this week?" })],
    );
    await renderAt("/chats/c1");
    const dialog = page.getByRole("dialog", { name: /Chat with Diana/ });
    await expect.element(dialog.getByText("Intake in progress")).toBeVisible();
    const panel = dialog.element();
    // Measured against the panel: it may still be sliding in.
    const panelBox = panel.getBoundingClientRect();
    expect(panelBox.width).toBeCloseTo(PHONE_VIEWPORT.width, 0);
    const overflowing = [...panel.querySelectorAll<HTMLElement>("*")].filter(
      (element) => element.getBoundingClientRect().right > panelBox.right + 0.5,
    );
    expect(overflowing).toEqual([]);
  });
});

describe("Round 2 regressions", () => {
  it("keeps the message at the page seam when a new one arrives after loading older", async () => {
    const thread = [
      makeMessage({ id: "old-1", body: "Oldest", created_at: hoursAgo(5) }),
      makeMessage({ id: "old-2", body: "Older", created_at: hoursAgo(4) }),
      makeMessage({ id: "seam", body: "At the seam", created_at: hoursAgo(3) }),
    ];
    // A one-message newest window that slides as messages arrive.
    server = {
      detail: async () => makeDetail(),
      messages: async (before) => {
        const total = thread.length;
        if (before === undefined) return toPage(thread.slice(-1), total);
        const cutoff = Date.parse(before);
        return toPage(
          thread.filter((message) => Date.parse(message.created_at) < cutoff),
          total,
        );
      },
    };
    await renderAt("/chats/c1");
    await userEvent.click(page.getByRole("button", { name: "Load older messages" }));
    await expect.element(messageList().getByText("Oldest")).toBeVisible();

    const arrived = makeMessage({
      id: "live",
      body: "Just now",
      created_at: new Date().toISOString(),
    });
    thread.push(arrived);
    stream.handlers.onMessageCreated?.({ conversation_id: "c1", message: arrived });

    await expect.element(messageList().getByText("Just now")).toBeVisible();
    const ids = messageList()
      .getByRole("listitem")
      .elements()
      .filter((item) => item.hasAttribute("data-message"))
      .map((item) => item.getAttribute("data-message"));
    expect(ids).toEqual(["old-1", "old-2", "seam", "live"]);
  });

  it("keeps a loaded chat on screen when a background refetch fails", async () => {
    let isDown = false;
    server = {
      detail: async () => {
        if (isDown) throw new Error("down");
        return makeDetail();
      },
      messages: async () => toPage([makeMessage({ body: "Still here" })]),
    };
    await renderAt("/chats/c1");
    await expect.element(messageList().getByText("Still here")).toBeVisible();
    const detailCalls = () =>
      network.get.mock.calls.filter(([url]) => url === "/api/conversations/c1").length;
    const before = detailCalls();

    isDown = true;
    stream.handlers.onConversationUpdated?.({
      ...makeDetail(),
      last_message_preview: "",
      unread: false,
    });
    await vi.waitFor(() => expect(detailCalls()).toBeGreaterThan(before));
    await new Promise((resolve) => setTimeout(resolve, 50));

    await expect.element(pane()).toBeVisible();
    expect(page.getByText("Couldn’t load this chat").elements()).toHaveLength(0);
    await expect.element(messageList().getByText("Still here")).toBeVisible();
  });

  it("offers no Retry on a failed system line of unknown kind", async () => {
    serve(makeDetail(), [
      makeMessage({
        id: "unknown",
        author_kind: "system",
        system_kind: null,
        body: "Something",
        status: "failed",
      }),
    ]);
    await renderAt("/chats/c1");
    await expect.element(messageList().getByText(/Something/)).toBeVisible();
    expect(messageList().getByRole("button", { name: "Retry" }).elements()).toHaveLength(0);
  });

  it("encodes the chat id in API paths", async () => {
    await renderAt(`/chats/${encodeURIComponent("../x")}`);
    await vi.waitFor(() =>
      expect(network.post).toHaveBeenCalledWith("/api/conversations/..%2Fx/read"),
    );
    expect(network.get).toHaveBeenCalledWith("/api/conversations/..%2Fx");
  });
});
