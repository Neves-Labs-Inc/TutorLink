import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { App } from "@/App";
import type { CountsRead } from "@/components/kit/shell/nav";
import type {
  ConversationDetail,
  FlagReason,
} from "@/lib/queries/conversations";
import { useAuthStore } from "@/stores/authStore";
import { createTestQueryClient, renderWithProviders } from "@/test/render-with-providers";

const PHONE_VIEWPORT = { width: 375, height: 760 };
const FLAGGED_AT = "2026-10-18T21:00:00.123456Z";

const network = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: network,
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/hooks/use-conversation-stream/useConversationStream", () => ({
  useConversationStream: () => ({
    status: "connected",
    error: null,
    errorCode: null,
    send: vi.fn(),
  }),
}));

const ME = { id: "u-1", email: "rita@example.com", role: "admin", name: "Rita Alves" };
const COUNTS: CountsRead = {
  needs_attention: 1,
  time_off_pending: 0,
  children_awaiting_evaluation: 0,
  bookings_to_sort_out: 0,
  children_needing_tutor: 0,
  unread_chats: 0,
};

function makeDetail(overrides: Partial<ConversationDetail> = {}): ConversationDetail {
  return {
    id: "c1",
    phone_number: "+13055550142",
    guardian: { id: "g1", name: "Diana Gómez" },
    status: "bot",
    taken_over_by: null,
    last_message_at: new Date().toISOString(),
    flag_reason: "stuck",
    intake_in_progress: false,
    taken_over_at: null,
    last_read_at: new Date().toISOString(),
    message_count: 0,
    unread_count: 0,
    created_at: new Date().toISOString(),
    reactivation_request: null,
    flagged_at: FLAGGED_AT,
    is_window_open: true,
    last_client_message_at: new Date().toISOString(),
    language: "en",
    ...overrides,
  };
}

function makeConflict(): Error {
  return Object.assign(new Error("conflict"), {
    isAxiosError: true,
    response: { status: 409, data: { detail: "conflict" } },
  });
}

const REACTIVATION = {
  child: { id: "ch1", name: "Emma Gómez", is_active: false, archived: true },
};

let current: ConversationDetail;
let posts: Record<string, () => Promise<{ data: ConversationDetail }>>;

function wireNetwork(): void {
  network.get.mockImplementation(async (url: string) => {
    if (url === "/api/me") return { data: ME };
    if (url === "/api/counts") return { data: COUNTS };
    if (url === "/api/conversations") {
      return { data: { items: [], total: 0, page: 1, page_size: 20 } };
    }
    if (url.endsWith("/messages")) {
      return { data: { items: [], total: 0, page: 1, page_size: 20 } };
    }
    return { data: current };
  });
  network.post.mockImplementation(async (url: string) => {
    const route = Object.entries(posts).find(([suffix]) => url.endsWith(suffix));
    if (route === undefined) throw new Error(`unexpected POST ${url}`);
    return route[1]();
  });
}

async function renderChat(): Promise<void> {
  window.history.pushState({}, "", "/chats/c1");
  useAuthStore.setState({ status: "authenticated", role: "admin" });
  await renderWithProviders(<App />, createTestQueryClient());
}

beforeEach(async () => {
  await page.viewport(1280, 800);
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  current = makeDetail();
  posts = {
    "/read": async () => ({ data: current }),
    "/handled": async () => {
      current = makeDetail({ flag_reason: null, flagged_at: null });
      return { data: current };
    },
    "/handled/undo": async () => {
      current = makeDetail();
      return { data: current };
    },
    "/reactivation/approve": async () => {
      current = makeDetail({ flag_reason: null, flagged_at: null });
      return { data: current };
    },
    "/reactivation/deny": async () => {
      current = makeDetail({ flag_reason: null, flagged_at: null });
      return { data: current };
    },
  };
  wireNetwork();
});

const card = () => page.getByRole("region", { name: "Needs attention" });

const CASES: [FlagReason, string, string][] = [
  ["booking_request", "Wants to book", "The bot can’t book this one"],
  ["question", "Has a question", "asked something the bot can’t answer"],
  ["guardian_link_request", "Link request", "A second Guardian wants"],
  ["stuck", "Bot got stuck", "Something failed on the bot’s side"],
  ["didnt_understand", "Bot didn't understand", "kept failing to make sense"],
  ["reply_window_closed", "Reply window closed", "Reach Diana outside the bot"],
];

describe("Needs attention card", () => {
  it.each(CASES)("shows %s with its label and explanation", async (reason, label, text) => {
    current = makeDetail({ flag_reason: reason });
    await renderChat();
    await expect
      .element(card().getByText(`Needs attention: ${label}`))
      .toBeVisible();
    await expect.element(card().getByText(new RegExp(text))).toBeVisible();
    await expect.element(card().getByText("Flagged Sun, Oct 18, 5:00 PM")).toBeVisible();
    await expect.element(card().getByRole("button", { name: "Mark done" })).toBeVisible();
  });

  it.each<[FlagReason, string]>([
    ["stuck", "--tl-danger-tint"],
    ["reply_window_closed", "--tl-warning-tint"],
    ["question", "--tl-yellow-tint"],
  ])("tints %s with %s", async (reason, token) => {
    current = makeDetail({ flag_reason: reason });
    await renderChat();
    await expect.element(card()).toBeVisible();
    expect(card().element().className).toContain(token);
  });

  it("is absent when nothing is flagged", async () => {
    current = makeDetail({ flag_reason: null, flagged_at: null });
    await renderChat();
    await expect
      .element(page.getByRole("region", { name: "Chat with Diana Gómez" }))
      .toBeVisible();
    expect(card().elements()).toHaveLength(0);
  });

  it("marks done with the flagged_at token, then Undo brings the card back", async () => {
    await renderChat();
    await userEvent.click(card().getByRole("button", { name: "Mark done" }));

    expect(network.post).toHaveBeenCalledWith("/api/conversations/c1/handled", {
      flagged_at: FLAGGED_AT,
    });
    await expect.element(page.getByText("Marked done.")).toBeVisible();
    expect(card().elements()).toHaveLength(0);

    await userEvent.click(page.getByRole("button", { name: "Undo" }));
    expect(network.post).toHaveBeenCalledWith("/api/conversations/c1/handled/undo");
    await expect.element(card()).toBeVisible();
    await vi.waitFor(() =>
      expect(document.activeElement?.textContent).toContain("Mark done"),
    );
  });

  it("says the reason changed when Mark done hits a 409, and refetches", async () => {
    posts["/handled"] = async () => {
      throw makeConflict();
    };
    await renderChat();
    const detailGets = () =>
      network.get.mock.calls.filter(([url]) => url === "/api/conversations/c1").length;
    const before = detailGets();
    await userEvent.click(card().getByRole("button", { name: "Mark done" }));

    await expect
      .element(
        card().getByText(
          "The reason changed since you opened this chat. Check it and try again.",
        ),
      )
      .toBeVisible();
    await vi.waitFor(() => expect(detailGets()).toBeGreaterThan(before));
  });

  it("shows an inline error when Mark done fails", async () => {
    posts["/handled"] = async () => {
      throw new Error("down");
    };
    await renderChat();
    await userEvent.click(card().getByRole("button", { name: "Mark done" }));
    await expect
      .element(card().getByText("Couldn’t mark it done. Try again."))
      .toBeVisible();
  });

  it("toasts an error when Undo hits a 409", async () => {
    await renderChat();
    await userEvent.click(card().getByRole("button", { name: "Mark done" }));
    posts["/handled/undo"] = async () => {
      throw makeConflict();
    };
    await userEvent.click(page.getByRole("button", { name: "Undo" }));
    await expect
      .element(page.getByText("Couldn’t undo. The chat has changed since."))
      .toBeVisible();
  });
});

describe("Reactivation request", () => {
  beforeEach(() => {
    current = makeDetail({
      flag_reason: "reactivation_request",
      reactivation_request: REACTIVATION,
    });
  });

  it("offers Restore and Decline but no Mark done", async () => {
    await renderChat();
    await expect
      .element(card().getByText("Diana asked to restore Emma Gómez, who is archived."))
      .toBeVisible();
    await expect.element(card().getByRole("button", { name: "Restore Emma" })).toBeVisible();
    await expect.element(card().getByRole("button", { name: "Decline" })).toBeVisible();
    expect(card().getByRole("button", { name: "Mark done" }).elements()).toHaveLength(0);
  });

  it("restores at once with a plain toast", async () => {
    await renderChat();
    await userEvent.click(card().getByRole("button", { name: "Restore Emma" }));
    expect(network.post).toHaveBeenCalledWith("/api/conversations/c1/reactivation/approve");
    await expect.element(page.getByText("Emma restored.")).toBeVisible();
    expect(page.getByRole("button", { name: "Undo" }).elements()).toHaveLength(0);
    expect(card().elements()).toHaveLength(0);
  });

  it("declines at once with a plain toast", async () => {
    await renderChat();
    await userEvent.click(card().getByRole("button", { name: "Decline" }));
    expect(network.post).toHaveBeenCalledWith("/api/conversations/c1/reactivation/deny");
    await expect.element(page.getByText("Request declined. Let Diana know.")).toBeVisible();
    expect(page.getByRole("button", { name: "Undo" }).elements()).toHaveLength(0);
  });

  it("says the request was already settled on a 409", async () => {
    posts["/reactivation/approve"] = async () => {
      throw makeConflict();
    };
    await renderChat();
    await userEvent.click(card().getByRole("button", { name: "Restore Emma" }));
    await expect
      .element(card().getByText("This request was already settled."))
      .toBeVisible();
  });

  it("shows an inline error when Decline fails", async () => {
    posts["/reactivation/deny"] = async () => {
      throw new Error("down");
    };
    await renderChat();
    await userEvent.click(card().getByRole("button", { name: "Decline" }));
    await expect
      .element(card().getByText("Couldn’t decline the request. Try again."))
      .toBeVisible();
  });
});

describe("Compact card on the phone overlay", () => {
  it("keeps the reason and actions, drops the flagged time and hides the explanation", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    await renderChat();
    await expect
      .element(card().getByText("Needs attention: Bot got stuck"))
      .toBeVisible();
    await expect.element(card().getByRole("button", { name: "Mark done" })).toBeVisible();
    expect(card().getByText(/Flagged/).elements()).toHaveLength(0);
    const explanation = card()
      .getByText(/Something failed on the bot’s side/)
      .element();
    expect(explanation.className).toContain("sr-only");
  });
});

describe("Focus", () => {
  it("returns to the pressed button after a failed act", async () => {
    posts["/handled"] = async () => {
      throw makeConflict();
    };
    await renderChat();
    await userEvent.click(card().getByRole("button", { name: "Mark done" }));
    await expect
      .element(card().getByText(/The reason changed/))
      .toBeVisible();
    await vi.waitFor(() =>
      expect(document.activeElement?.textContent).toContain("Mark done"),
    );
  });

  it("returns to Decline after it fails", async () => {
    current = makeDetail({
      flag_reason: "reactivation_request",
      reactivation_request: REACTIVATION,
    });
    posts["/reactivation/deny"] = async () => {
      throw new Error("down");
    };
    await renderChat();
    await userEvent.click(card().getByRole("button", { name: "Decline" }));
    await vi.waitFor(() =>
      expect(document.activeElement?.textContent).toContain("Decline"),
    );
  });

  it("sends Undo focus only to this chat's card, never another's Mark done", async () => {
    await renderChat();
    await userEvent.click(card().getByRole("button", { name: "Mark done" }));
    await expect.element(page.getByText("Marked done.")).toBeVisible();
    // A different chat's card is on screen when Undo lands.
    const other = document.createElement("button");
    other.textContent = "Mark done";
    other.setAttribute("data-attention-chat", "c2");
    other.setAttribute("data-attention-act", "mark-done");
    document.body.prepend(other);

    await userEvent.click(page.getByRole("button", { name: "Undo" }));
    await expect.element(card()).toBeVisible();
    await vi.waitFor(() =>
      expect(
        card().element().contains(document.activeElement),
      ).toBe(true),
    );
    expect(document.activeElement).not.toBe(other);
    other.remove();
  });
});
