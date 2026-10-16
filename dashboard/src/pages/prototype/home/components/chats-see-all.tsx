// Where Chats' "See all" lands: Chats ▸ Conversations, filtered to Needs
// attention, in the same order as the card. The Chats page itself is
// designed in its own prototype; this only proves the hand-off.
import type { ReactNode } from "react";
import { Filter, MessageCircleHeart } from "lucide-react";
import { SubPageTabs } from "@/pages/prototype/shell-kit/kit/components/tabs";
import { PageHeader } from "@/pages/prototype/shell-kit/kit/shell/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/pages/prototype/shell-kit/kit/states/states";
import { CARD, cn } from "@/pages/prototype/shell-kit/kit/tokens";
import ChatTodoRow from "@/pages/prototype/home/components/chat-todo-row";
import PrototypeNote from "@/pages/prototype/home/components/prototype-note";
import type { HomeDataApi } from "@/pages/prototype/home/hooks/use-home-data";
import { useTodoActions } from "@/pages/prototype/home/hooks/use-todo-actions";
import { sortChatsByWindow } from "@/pages/prototype/home/lib/labels";
import { CURRENT_STAFF } from "@/pages/prototype/home/lib/mock-api";
import type { OfficeRole } from "@/pages/prototype/home/lib/mock-api";
import type { ConversationSummary } from "@/pages/prototype/home/types/api";

const TABS = [
  { id: "conversations", label: "Conversations" },
  { id: "reminders", label: "Reminders" },
];

type ChatsSeeAllProps = {
  role: OfficeRole;
  api: HomeDataApi;
  onOpenChat: (chat: ConversationSummary) => void;
};

export default function ChatsSeeAll({
  role,
  api,
  onOpenChat,
}: ChatsSeeAllProps): ReactNode {
  const actions = useTodoActions(api);
  const chats = sortChatsByWindow(api.data?.chats.items ?? []);

  let list: ReactNode = (
    <ul className={cn(CARD, "flex flex-col px-2 py-1 @2xl:px-3")}>
      {chats.map((chat) => (
        <ChatTodoRow
          key={chat.id}
          chat={chat}
          currentUserId={CURRENT_STAFF[role].id}
          isMarking={actions.busyId === chat.id}
          onOpen={onOpenChat}
          onMarkDone={actions.markDone}
        />
      ))}
    </ul>
  );
  if (api.phase === "loading") {
    list = <ListSkeleton rows={4} label="Loading chats" />;
  } else if (api.phase === "error") {
    list = (
      <ErrorState
        title="Couldn’t load chats"
        body="Check your connection and try again."
        onRetry={api.retry}
      />
    );
  } else if (chats.length === 0) {
    list = (
      <EmptyState
        icon={MessageCircleHeart}
        title="No chat needs attention"
        body="When the bot hands a chat to the office, it shows here and on Home."
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Chats"
        tabs={
          <SubPageTabs
            label="Chats pages"
            items={TABS}
            activeId="conversations"
            onChange={() => undefined}
          />
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-11 items-center gap-2 rounded-full bg-(--tl-tint-strong) px-4 text-[14px] font-semibold text-(--tl-primary-ink)">
            <Filter aria-hidden className="size-4" />
            Needs attention · {chats.length}
          </span>
          <PrototypeNote>
            The Chats page is its own prototype. This shows where Home’s
            “See all” lands: Conversations, filtered to Needs attention,
            closest to losing Takeover first.
          </PrototypeNote>
        </div>
      </PageHeader>
      {list}
    </>
  );
}
