import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { App } from "@/App";
import type { CountsRead } from "@/components/kit/shell/nav";
import type {
  Conversation,
  ConversationListParams,
} from "@/lib/queries/conversations";
import type { Page } from "@/lib/queries/page";
import { useAuthStore } from "@/stores/authStore";
import { renderWithProviders } from "@/test/render-with-providers";

const SPLIT_VIEWPORT = { width: 1280, height: 800 };
const PHONE_VIEWPORT = { width: 375, height: 800 };
const STACKED_VIEWPORT = { width: 900, height: 800 };
const ME_ID = "u-1";
const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const network = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const stream = vi.hoisted(() => ({
  handlers: {} as {
    onConversationUpdated?: (conversation: unknown) => void;
    onMessageCreated?: (frame: unknown) => void;
  },
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get, post: network.post },
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/hooks/use-conversation-stream/useConversationStream", () => ({
  useConversationStream: (handlers: typeof stream.handlers) => {
    stream.handlers = handlers;
    return { send: vi.fn(), status: "connected" };
  },
}));

const ME = {
  id: ME_ID,
  email: "rita@example.com",
  role: "admin",
  name: "Rita",
};
const COUNTS: CountsRead = {
  needs_attention: 1,
  time_off_pending: 0,
  children_awaiting_evaluation: 0,
  bookings_to_sort_out: 0,
  children_needing_tutor: 0,
  unread_chats: 1,
};

function makeChat(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "c-1",
    phone_number: "+1 305 555 0100",
    guardian: { id: "g-1", name: "Lucía Torres" },
    status: "bot",
    taken_over_by: null,
    last_message_at: new Date(NOW - HOUR_MS).toISOString(),
    last_message_preview: "Hello",
    unread: false,
    flag_reason: null,
    intake_in_progress: false,
    last_client_message_at: new Date(NOW - HOUR_MS).toISOString(),
    is_window_open: true,
    flagged_at: null,
    ...overrides,
  };
}

function toPage(
  items: Conversation[],
  params: ConversationListParams,
  total = items.length,
): Page<Conversation> {
  return {
    items,
    total,
    page: params.page ?? 1,
    page_size: params.page_size ?? 20,
  };
}

const NO_MESSAGES = { items: [], total: 0, page: 1, page_size: 20 };

type ListResponder = (
  params: ConversationListParams,
) => Promise<Page<Conversation>> | Page<Conversation>;

const lists: { attention: ListResponder; others: ListResponder } = {
  attention: (params) => toPage([], params),
  others: (params) => toPage([], params),
};

function respond(): void {
  network.get.mockImplementation(
    async (url: string, config?: { params?: ConversationListParams }) => {
      if (url === "/api/me") return { data: ME };
      if (url === "/api/counts") return { data: COUNTS };
      if (url === "/api/conversations") {
        const params = config?.params ?? {};
        const responder = params.flagged ? lists.attention : lists.others;
        return { data: await responder(params) };
      }
      // An opened chat's thread: its detail and an empty history.
      if (url.endsWith("/messages")) return { data: NO_MESSAGES };
      if (url.startsWith("/api/conversations/")) {
        return { data: makeChat({ id: url.split("/").pop() }) };
      }
      throw new Error(`unexpected GET ${url}`);
    },
  );
  network.post.mockImplementation(async (url: string) => ({
    data: makeChat({ id: url.split("/").at(-2) }),
  }));
}

function listCalls(): ConversationListParams[] {
  return network.get.mock.calls
    .filter(([url]) => url === "/api/conversations")
    .map(([, config]) => (config as { params: ConversationListParams }).params);
}

function lastCall(flagged: boolean): ConversationListParams | undefined {
  return listCalls()
    .filter((params) => params.flagged === flagged)
    .at(-1);
}

async function renderAt(path: string): Promise<void> {
  window.history.pushState({}, "", path);
  useAuthStore.setState({
    status: "authenticated",
    role: "admin",
    userId: ME_ID,
  });
  await renderWithProviders(<App />);
}

const section = (name: string) => page.getByRole("region", { name });

beforeEach(async () => {
  await page.viewport(SPLIT_VIEWPORT.width, SPLIT_VIEWPORT.height);
  vi.useRealTimers();
  network.get.mockReset();
  stream.handlers = {};
  lists.attention = (params) => toPage([], params);
  lists.others = (params) => toPage([makeChat()], params);
  respond();
});

describe("Conversations requests", () => {
  it("asks for all Needs attention chats and the first page of the others", async () => {
    await renderAt("/chats");
    await expect.element(section("All chats")).toBeVisible();
    expect(lastCall(true)).toEqual({ flagged: true, page_size: 100 });
    expect(lastCall(false)).toEqual({ flagged: false, page: 1, page_size: 20 });
  });

  it("searches both sections after a pause, from page 1", async () => {
    await renderAt("/chats?page=2");
    await userEvent.fill(
      page.getByRole("searchbox", { name: "Search chats" }),
      "maria",
    );
    await vi.waitFor(() => expect(lastCall(false)?.q).toBe("maria"));
    expect(lastCall(true)).toEqual({
      flagged: true,
      q: "maria",
      page_size: 100,
    });
    expect(lastCall(false)).toEqual({
      flagged: false,
      q: "maria",
      page: 1,
      page_size: 20,
    });
    expect(window.location.search).toBe("?q=maria");
  });

  it("waits for typing to stop before searching", async () => {
    await renderAt("/chats");
    await expect.element(section("All chats")).toBeVisible();
    const before = listCalls().length;
    // Fake timers: under load, real keystrokes can land >300ms apart.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await userEvent.type(
      page.getByRole("searchbox", { name: "Search chats" }),
      "ana",
    );
    expect(listCalls().slice(before)).toEqual([]);
    vi.advanceTimersByTime(300);
    vi.useRealTimers();
    await vi.waitFor(() => expect(lastCall(false)?.q).toBe("ana"));
    expect(
      listCalls()
        .slice(before)
        .map((params) => params.q),
    ).toEqual(["ana", "ana"]);
  });

  it("keeps the typed text in the box while the search is written", async () => {
    await renderAt("/chats");
    await expect.element(section("All chats")).toBeVisible();
    const box = page.getByRole("searchbox", { name: "Search chats" });
    const input = box.element() as HTMLInputElement;
    await userEvent.type(box, "ana");
    // Record every value React writes to the box from here on.
    const seen: string[] = [];
    const own = Object.getOwnPropertyDescriptor(input, "value");
    const base = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    );
    const inner = own ?? base;
    Object.defineProperty(input, "value", {
      configurable: true,
      get() {
        return inner?.get?.call(this);
      },
      set(value: string) {
        seen.push(value);
        inner?.set?.call(this, value);
      },
    });
    await vi.waitFor(() => expect(window.location.search).toBe("?q=ana"));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(seen.filter((value) => value !== "ana")).toEqual([]);
    await expect.element(box).toHaveValue("ana");
  });

  it("filters both sections to unread chats", async () => {
    await renderAt("/chats");
    await userEvent.click(
      page.getByRole("button", { name: "Unread", exact: true }),
    );
    await vi.waitFor(() => expect(lastCall(false)?.unread).toBe(true));
    expect(lastCall(true)).toEqual({
      flagged: true,
      unread: true,
      page_size: 100,
    });
    await expect
      .element(page.getByRole("button", { name: "Unread", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    expect(window.location.search).toBe("?unread=1");
  });

  it("filters by who the chat is with, picked from the With menu", async () => {
    await renderAt("/chats");
    await userEvent.click(page.getByRole("button", { name: "With" }));
    await userEvent.click(
      page.getByRole("checkbox", { name: "Taken over by you" }),
    );
    await vi.waitFor(() => expect(lastCall(false)?.holder).toEqual(["mine"]));
    await userEvent.click(
      page.getByRole("checkbox", { name: "Taken over by others" }),
    );
    await vi.waitFor(() =>
      expect(lastCall(false)?.holder).toEqual(["mine", "others"]),
    );
    expect(lastCall(true)?.holder).toEqual(["mine", "others"]);
    expect(window.location.search).toBe("?with=mine&with=others");
  });

  it.each([
    [["bot"]],
    [["mine"]],
    [["others"]],
    [["bot", "mine"]],
    [["bot", "others"]],
    [["mine", "others"]],
    [["bot", "mine", "others"]],
  ])("sends holder=%s for that With choice", async (holders) => {
    const search = holders.map((holder) => `with=${holder}`).join("&");
    await renderAt(`/chats?${search}`);
    await vi.waitFor(() => expect(lastCall(false)?.holder).toEqual(holders));
    expect(lastCall(true)?.holder).toEqual(holders);
  });

  it("sends the page from the URL for the other chats only", async () => {
    lists.others = (params) => toPage([makeChat()], params, 45);
    await renderAt("/chats?page=2");
    await vi.waitFor(() => expect(lastCall(false)?.page).toBe(2));
    expect(lastCall(true)?.page).toBeUndefined();
  });
});

const ANA = makeChat({
  id: "c-ana",
  guardian: { id: "g-ana", name: "Ana Pérez" },
  flag_reason: "booking_request",
  status: "human",
  taken_over_by: { id: ME_ID, name: "Rita Gómez" },
  intake_in_progress: true,
  unread: true,
  last_message_preview: "Can we move Thursday to 4?",
});
const BRUNO = makeChat({
  id: "c-bruno",
  guardian: { id: "g-bruno", name: "Bruno Silva" },
  flag_reason: "stuck",
});
const NUMBER_ONLY = makeChat({
  id: "c-number",
  guardian: null,
  phone_number: "+1 305 555 0142",
  last_message_preview: null,
  last_message_at: new Date(NOW - DAY_MS).toISOString(),
});
const MARIAS = makeChat({
  id: "c-maria",
  guardian: { id: "g-carla", name: "Carla Ruiz" },
  status: "human",
  taken_over_by: { id: "u-2", name: "Maria López" },
});

function rowFor(name: string) {
  return page.getByRole("button", { name: new RegExp(name) });
}

describe("Conversations sections", () => {
  it("puts Needs attention first, in the server's order, then Other chats", async () => {
    lists.attention = (params) => toPage([BRUNO, ANA], params);
    lists.others = (params) => toPage([NUMBER_ONLY, MARIAS], params, 2);
    await renderAt("/chats");

    const headings = page.getByRole("heading", { level: 2 });
    await expect
      .element(headings.first())
      .toHaveTextContent("Needs attention · 2");
    await expect.element(headings.nth(1)).toHaveTextContent("Other chats · 2");
    const attentionRows = section("Needs attention").getByRole("listitem");
    await expect
      .element(attentionRows.first())
      .toHaveTextContent(/Bruno Silva/);
    await expect.element(attentionRows.nth(1)).toHaveTextContent(/Ana Pérez/);
  });

  it("calls the list All chats when nothing needs attention", async () => {
    lists.others = (params) => toPage([MARIAS], params, 1);
    await renderAt("/chats");
    await expect.element(section("All chats")).toBeVisible();
    expect(section("Needs attention").elements()).toHaveLength(0);
  });

  it("leaves out Other chats when every chat needs attention", async () => {
    lists.attention = (params) => toPage([BRUNO], params);
    lists.others = (params) => toPage([], params);
    await renderAt("/chats");
    await expect.element(section("Needs attention")).toBeVisible();
    expect(section("Other chats").elements()).toHaveLength(0);
    expect(section("All chats").elements()).toHaveLength(0);
  });
});

describe("Conversation rows", () => {
  it("shows the Guardian, time, preview and an unread dot", async () => {
    lists.attention = (params) => toPage([ANA], params);
    await renderAt("/chats");
    const row = rowFor("Ana Pérez");
    await expect.element(row).toHaveTextContent(/Can we move Thursday to 4\?/);
    await expect
      .element(row.getByText("Unread", { exact: true }))
      .toHaveClass("sr-only");
  });

  it("names an unnamed chat by its number, with no preview yet", async () => {
    lists.others = (params) => toPage([NUMBER_ONLY], params);
    await renderAt("/chats");
    const row = rowFor("\\+1 305 555 0142");
    await expect.element(row).toHaveTextContent(/Yesterday/);
    await expect.element(row).toHaveTextContent(/No messages yet/);
    expect(row.getByText("Unread").elements()).toHaveLength(0);
  });

  it("lists the badges in order: reason, intake, holder, window", async () => {
    lists.attention = (params) => toPage([ANA], params);
    await renderAt("/chats");
    await expect
      .element(rowFor("Ana Pérez"))
      .toHaveTextContent(
        /Wants to book\s*Intake in progress\s*Taken over by you\s*Replies close in 2[23]h/,
      );
  });

  it("names a colleague's takeover and never shows a Bot badge", async () => {
    lists.others = (params) => toPage([MARIAS, makeChat()], params);
    await renderAt("/chats");
    await expect
      .element(rowFor("Carla Ruiz"))
      .toHaveTextContent(/Taken over by Maria/);
    await expect.element(rowFor("Lucía Torres")).not.toHaveTextContent(/Bot/);
  });

  it("shows the window cue only on flagged chats and my takeovers", async () => {
    lists.attention = (params) => toPage([BRUNO], params);
    lists.others = (params) => toPage([MARIAS], params);
    await renderAt("/chats");
    await expect
      .element(rowFor("Bruno Silva"))
      .toHaveTextContent(/Takeover closes in/);
    await expect.element(rowFor("Carla Ruiz")).not.toHaveTextContent(/close/);
  });

  it("opens the chat, keeping the filters, and marks it in the split view", async () => {
    lists.attention = (params) => toPage([BRUNO], params);
    await renderAt("/chats?unread=1");
    await userEvent.click(rowFor("Bruno Silva"));
    expect(window.location.pathname).toBe("/chats/c-bruno");
    expect(window.location.search).toBe("?unread=1");
    await expect
      .element(rowFor("Bruno Silva"))
      .toHaveAttribute("aria-current", "true");
  });

  it("marks no row below the split, where the chat covers the list", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    lists.attention = (params) => toPage([BRUNO], params);
    await renderAt("/chats/c-bruno");
    // The chat overlay hides the list behind it from the accessibility tree.
    await expect
      .element(
        page.getByRole("button", { name: /Bruno Silva/, includeHidden: true }),
      )
      .not.toHaveAttribute("aria-current");
  });
});

function manyChats(count: number, prefix: string): Conversation[] {
  return Array.from({ length: count }, (_, index) =>
    makeChat({
      id: `${prefix}-${index + 1}`,
      guardian: {
        id: `g-${prefix}-${index + 1}`,
        name: `${prefix} ${index + 1}`,
      },
    }),
  );
}

// 45 other chats, 20 to a page, each page's rows named after it.
function pagedOthers(params: ConversationListParams): Page<Conversation> {
  const pageNumber = params.page ?? 1;
  const rows = manyChats(pageNumber === 3 ? 5 : 20, `Page${pageNumber}`);
  return toPage(rows, params, 45);
}

describe("Conversations pages", () => {
  it("shows no Pager for 20 chats or fewer", async () => {
    lists.others = (params) => toPage(manyChats(20, "Chat"), params, 20);
    await renderAt("/chats");
    await expect.element(section("All chats")).toBeVisible();
    expect(
      page.getByRole("navigation", { name: "Chats pages" }).elements(),
    ).toHaveLength(0);
  });

  it("pages through the other chats", async () => {
    lists.others = pagedOthers;
    await renderAt("/chats");
    const pager = page.getByRole("navigation", { name: "Chats pages" });
    await userEvent.click(pager.getByRole("button", { name: "Next" }));
    await expect.element(rowFor("^Page2 1\\b")).toBeVisible();
    expect(window.location.search).toBe("?page=2");
    await expect.element(pager).toHaveTextContent(/21–40 of 45/);
  });

  it("goes back to page 1 when a filter changes", async () => {
    lists.others = pagedOthers;
    await renderAt("/chats?page=2");
    await expect.element(rowFor("^Page2 1\\b")).toBeVisible();
    await userEvent.click(
      page.getByRole("button", { name: "Unread", exact: true }),
    );
    await vi.waitFor(() => expect(lastCall(false)?.unread).toBe(true));
    expect(lastCall(false)?.page).toBe(1);
    expect(window.location.search).toBe("?unread=1");
  });

  it("keeps the filters and page when a chat opens and closes, and on back", async () => {
    // Below the split, where the chat overlay has a Close button.
    await page.viewport(STACKED_VIEWPORT.width, STACKED_VIEWPORT.height);
    lists.others = pagedOthers;
    await renderAt("/chats?unread=1&page=2");
    await userEvent.click(rowFor("^Page2 3\\b"));
    expect(window.location.pathname).toBe("/chats/Page2-3");
    await userEvent.click(
      page.getByRole("dialog").getByRole("button", { name: "Close" }),
    );
    expect(window.location.search).toBe("?unread=1&page=2");

    await userEvent.click(rowFor("^Page2 4\\b"));
    window.history.back();
    await vi.waitFor(() => expect(window.location.pathname).toBe("/chats"));
    expect(window.location.search).toBe("?unread=1&page=2");
    await expect.element(rowFor("^Page2 4\\b")).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Unread", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("moves back to the last page when the page is past the end", async () => {
    lists.others = pagedOthers;
    await renderAt("/chats?page=9");
    await vi.waitFor(() => expect(window.location.search).toBe("?page=3"));
    await expect.element(rowFor("^Page3 1\\b")).toBeVisible();
  });

  it("keeps the old rows, busy, while the next page loads", async () => {
    let release = (): void => {};
    lists.others = (params) =>
      (params.page ?? 1) === 1
        ? pagedOthers(params)
        : new Promise((resolve) => {
            release = () => resolve(pagedOthers(params));
          });
    await renderAt("/chats");
    const pager = page.getByRole("navigation", { name: "Chats pages" });
    await userEvent.click(pager.getByRole("button", { name: "Next" }));

    await expect
      .element(section("All chats"))
      .toHaveAttribute("aria-busy", "true");
    await expect.element(rowFor("^Page1 1\\b")).toBeVisible();
    await expect
      .element(pager.getByRole("button", { name: "Next" }))
      .toHaveAttribute("aria-disabled", "true");
    expect(
      page.getByRole("status", { name: "Loading chats" }).elements(),
    ).toHaveLength(0);

    // The page-2 fetch must have started, or release() is a no-op.
    await vi.waitFor(() => expect(lastCall(false)?.page).toBe(2));
    release();
    await expect.element(rowFor("^Page2 1\\b")).toBeVisible();
    await expect.element(section("All chats")).not.toHaveAttribute("aria-busy");
  });

  it("brings the heading back into view when the next page arrives", async () => {
    lists.others = pagedOthers;
    await renderAt("/chats");
    const pager = page.getByRole("navigation", { name: "Chats pages" });
    await userEvent.click(pager.getByRole("button", { name: "Next" }));
    await expect.element(rowFor("^Page2 1\\b")).toBeVisible();
    const heading = section("All chats").getByRole("heading").element();
    const pane = heading.closest("section")?.parentElement?.parentElement;
    await vi.waitFor(() => {
      const paneTop = pane?.getBoundingClientRect().top ?? 0;
      expect(heading.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        paneTop - 1,
      );
    });
  });

  it("keeps the old rows and offers a retry when a page fails", async () => {
    let isDown = true;
    lists.others = (params) => {
      if ((params.page ?? 1) === 2 && isDown) throw new Error("down");
      return pagedOthers(params);
    };
    await renderAt("/chats");
    const pager = page.getByRole("navigation", { name: "Chats pages" });
    await userEvent.click(pager.getByRole("button", { name: "Next" }));

    const alert = section("All chats").getByRole("alert");
    await expect
      .element(alert)
      .toHaveTextContent(/Couldn’t load this page. Check your connection./);
    await expect.element(rowFor("^Page1 1\\b")).toBeVisible();
    await expect
      .element(section("All chats").getByRole("heading"))
      .toHaveTextContent("All chats · 45");
    await expect.element(pager).toHaveTextContent(/Page 2 of 3/);

    isDown = false;
    await userEvent.click(alert.getByRole("button", { name: "Try again" }));
    await expect.element(rowFor("^Page2 1\\b")).toBeVisible();
  });

  it("gives Needs attention its own Pager past 100 chats", async () => {
    lists.attention = (params) =>
      toPage(manyChats(100, `Flag${params.page ?? 1}`), params, 130);
    await renderAt("/chats");
    const pager = page.getByRole("navigation", {
      name: "Needs attention pages",
    });
    await userEvent.click(pager.getByRole("button", { name: "Next" }));
    await expect.element(rowFor("^Flag2 1\\b")).toBeVisible();
    expect(lastCall(true)).toEqual({ flagged: true, page: 2, page_size: 100 });
  });
});

describe("Conversations live updates", () => {
  it.each(["onConversationUpdated", "onMessageCreated"] as const)(
    "refetches the list and counts on %s",
    async (handler) => {
      await renderAt("/chats");
      await expect.element(section("All chats")).toBeVisible();
      lists.others = (params) => toPage([MARIAS], params);
      const countCalls = () =>
        network.get.mock.calls.filter(([url]) => url === "/api/counts").length;
      const countsBefore = countCalls();

      stream.handlers[handler]?.({});
      await expect.element(rowFor("Carla Ruiz")).toBeVisible();
      await vi.waitFor(() =>
        expect(countCalls()).toBeGreaterThan(countsBefore),
      );
    },
  );
});

describe("Conversations states", () => {
  it("shows a skeleton on the first load", async () => {
    lists.others = () => new Promise(() => {});
    await renderAt("/chats");
    await expect
      .element(page.getByRole("status", { name: "Loading chats" }))
      .toBeInTheDocument();
  });

  it("says it couldn't load the chats and retries both lists", async () => {
    let isDown = true;
    lists.attention = (params) => {
      if (isDown) throw new Error("down");
      return toPage([BRUNO], params);
    };
    await renderAt("/chats");
    const alert = page.getByRole("alert");
    await expect.element(alert).toHaveTextContent(/Couldn’t load chats/);
    await expect
      .element(alert)
      .toHaveTextContent(/Check your connection and try again./);

    isDown = false;
    const before = listCalls().length;
    await userEvent.click(alert.getByRole("button", { name: "Try again" }));
    await expect.element(rowFor("Bruno Silva")).toBeVisible();
    const retried = listCalls()
      .slice(before)
      .map((params) => params.flagged);
    expect(retried).toEqual(expect.arrayContaining([true, false]));
  });

  it("says there are no chats yet when there are none", async () => {
    lists.others = (params) => toPage([], params);
    await renderAt("/chats");
    await expect
      .element(page.getByRole("heading", { name: "No chats yet" }))
      .toBeVisible();
    await expect
      .element(
        page.getByText(
          "When a Guardian messages the WhatsApp number, their chat shows up here.",
        ),
      )
      .toBeVisible();
    expect(
      page.getByRole("status").filter({ hasText: "chats shown" }).elements(),
    ).toHaveLength(0);
  });

  it("says nothing matches when filters leave no chats", async () => {
    lists.others = (params) => toPage([], params);
    await renderAt("/chats?q=zzz");
    await expect
      .element(page.getByRole("heading", { name: "No chats match" }))
      .toBeVisible();
    await expect
      .element(
        page.getByText("Try another name or number, or clear the filters."),
      )
      .toBeVisible();
    await expect
      .element(page.getByText("0 chats shown"))
      .toHaveAttribute("role", "status");
  });

  it("announces how many chats the filters show", async () => {
    lists.attention = (params) => toPage([BRUNO], params);
    lists.others = (params) => toPage([MARIAS], params, 31);
    await renderAt("/chats?unread=1");
    await expect
      .element(page.getByText("32 chats shown"))
      .toHaveAttribute("role", "status");
  });

  it("clears Unread and With with Clear all, keeping the search", async () => {
    await renderAt("/chats?q=ana&unread=1&with=bot");
    await userEvent.click(page.getByRole("button", { name: "Clear all" }));
    await vi.waitFor(() => expect(window.location.search).toBe("?q=ana"));
    expect(
      page.getByRole("button", { name: "Clear all" }).elements(),
    ).toHaveLength(0);
  });
});

describe("Conversations layout", () => {
  it("wraps the badges at 375px with no sideways scroll, rows at least 72px", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    lists.attention = (params) =>
      toPage([{ ...ANA, flag_reason: "didnt_understand" }], params);
    await renderAt("/chats");
    const row = rowFor("Ana Pérez");
    await expect.element(row).toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    expect(row.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(
      72,
    );
  });

  it("gives each row exactly one tab stop", async () => {
    lists.attention = (params) => toPage([ANA, BRUNO], params);
    await renderAt("/chats");
    const items = section("Needs attention").getByRole("listitem");
    await expect.element(items.first()).toBeVisible();
    for (const item of items.elements()) {
      expect(
        item.querySelectorAll("button, a, input, [tabindex]"),
      ).toHaveLength(1);
    }
  });

  it("draws the list as its own card below the split", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    await renderAt("/chats");
    await expect.element(section("All chats")).toBeVisible();
    const list = section("All chats").element().parentElement;
    expect(list?.className).toContain("kit-shadow-soft");
  });

  it("sits bare in the split pane, empty state included", async () => {
    lists.others = (params) => toPage([], params);
    await renderAt("/chats?q=zzz");
    const title = page.getByRole("heading", { name: "No chats match" });
    await expect.element(title).toBeVisible();
    expect(title.element().parentElement?.className).not.toContain(
      "kit-shadow-soft",
    );
  });

  it("shows the error state as a card below the split", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    lists.others = () => {
      throw new Error("down");
    };
    await renderAt("/chats");
    const alert = page.getByRole("alert");
    await expect.element(alert).toHaveTextContent(/Couldn’t load chats/);
    expect(alert.element().className).toContain("kit-shadow-soft");
  });

  it("styles an unread row and the open row", async () => {
    lists.attention = (params) => toPage([ANA], params);
    await renderAt("/chats/c-ana");
    const row = rowFor("Ana Pérez");
    await expect.element(row).toHaveAttribute("aria-current", "true");
    expect(row.element().className).toContain("bg-(--tl-tint-strong)");
    expect(
      row.element().parentElement?.querySelector(".bg-\\(--tl-primary\\).w-1"),
    ).not.toBeNull();
    await expect.element(row.getByText("Ana Pérez")).toHaveClass("font-bold");
  });

  it("scrolls only the list pane on a page change, never the kit root", async () => {
    lists.others = pagedOthers;
    await renderAt("/chats");
    const pager = page.getByRole("navigation", { name: "Chats pages" });
    await userEvent.click(pager.getByRole("button", { name: "Next" }));
    await expect.element(rowFor("^Page2 1\\b")).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const roots = [...document.querySelectorAll("[data-kit]")];
    expect(roots.map((root) => root.scrollTop)).toEqual(roots.map(() => 0));
  });

  it("insets the row focus ring", async () => {
    lists.attention = (params) => toPage([ANA], params);
    await renderAt("/chats");
    const row = rowFor("Ana Pérez");
    await expect.element(row).toBeVisible();
    await userEvent.keyboard("{Shift}");
    (row.element() as HTMLElement).focus();
    expect(row.element().matches(":focus-visible")).toBe(true);
    expect(getComputedStyle(row.element()).outlineOffset).toBe("-2px");
  });
});
