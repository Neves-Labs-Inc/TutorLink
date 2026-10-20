import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import KitRoot from "@/components/kit/kit-root";
import { renderWithProviders } from "@/test/render-with-providers";
import ChatThread from "@/pages/prototype/chats/components/chat-thread";
import ConversationList from "@/pages/prototype/chats/components/conversation-list";
import { buildChatData, buildCounts, toSummary } from "@/pages/prototype/chats/mock/chats-mock";
import type { ChatsApi } from "@/pages/prototype/chats/hooks/use-chats";
import type { ConversationRead } from "@/pages/prototype/chats/types/api";

const ME = { id: "u-maria", name: "Maria Lopez" };
const COLLEAGUE = { id: "u-daniela", name: "Daniela Cruz" };

function chatsApiFor(change: Partial<ConversationRead>, id: string): ChatsApi {
  const data = buildChatData(ME, COLLEAGUE);
  const conversations = data.conversations.map((item) =>
    item.id === id ? { ...item, ...change } : item,
  );
  const noop = vi.fn();
  const summaries = conversations.map((item) => toSummary(item, data.messages[item.id]));
  return {
    summaries,
    counts: buildCounts(summaries),
    getConversation: (conversationId) =>
      conversations.find((item) => item.id === conversationId) ?? null,
    getMessages: (conversationId) => data.messages[conversationId],
    markRead: noop,
    takeOver: noop,
    transferToMe: noop,
    handBack: noop,
    markDone: noop,
    resolveReactivation: noop,
    send: noop,
    retry: noop,
    setLanguage: noop,
  };
}

function renderThread(chats: ChatsApi, id: string) {
  return renderWithProviders(
    <KitRoot theme="light">
      <ChatThread
        chats={chats}
        conversationId={id}
        meId={ME.id}
        load="ready"
        container="pane"
        onClose={vi.fn()}
        onRetryLoad={vi.fn()}
      />
    </KitRoot>,
  );
}

function renderList(chats: ChatsApi, id: string) {
  return renderWithProviders(
    <KitRoot theme="light">
      <ConversationList
        summaries={chats.summaries.filter((summary) => summary.id === id)}
        windows={{}}
        selectedId={null}
        meId={ME.id}
        onOpen={vi.fn()}
      />
    </KitRoot>,
  );
}

// c-laura is a named Guardian; c-new is an unnamed number.
describe("prototype Intake in progress badge wiring", () => {
  it("thread header shows it for a named Guardian when intake_in_progress is true", async () => {
    await renderThread(chatsApiFor({ intake_in_progress: true }, "c-laura"), "c-laura");

    await expect.element(page.getByText("Intake in progress")).toBeVisible();
  });

  it("thread header hides it for an unnamed number when intake_in_progress is false", async () => {
    await renderThread(chatsApiFor({ intake_in_progress: false }, "c-new"), "c-new");

    await expect.element(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
    expect(document.body.textContent).not.toContain("Intake in progress");
  });

  it("list row shows it for a named Guardian when intake_in_progress is true", async () => {
    await renderList(chatsApiFor({ intake_in_progress: true }, "c-laura"), "c-laura");

    await expect.element(page.getByText("Intake in progress").first()).toBeVisible();
  });

  it("list row hides it for an unnamed number when intake_in_progress is false", async () => {
    await renderList(chatsApiFor({ intake_in_progress: false }, "c-new"), "c-new");

    await expect.element(page.getByText("Gabriela").or(page.getByText("786 555 0199")).first()).toBeVisible();
    expect(document.body.textContent).not.toContain("Intake in progress");
  });
});
