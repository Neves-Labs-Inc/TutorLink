// The Chats page frame: header, sub-page tabs, and the Conversations
// split (list + thread) or the Reminders panel. The list, thread and
// reminders contents are their own modules.
import { useRef } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { SubPageTabs } from "@/components/kit/components/tabs";
import { PageHeader } from "@/components/kit/shell/page-header";
import { EmptyState, Skeleton } from "@/components/kit/states/states";
import { CARD, cn } from "@/components/kit/tokens";
import { countsQueries } from "@/lib/queries/counts";
import { ChatThread } from "@/pages/chats/chat-thread";
import { ConversationList } from "@/pages/chats/conversation-list";
import { ConversationsToolbar } from "@/pages/chats/conversations-toolbar";
import { RemindersPanel } from "@/pages/chats/reminders-panel";
import { useIsSplit } from "@/pages/chats/use-is-split";

export type ChatsTab = "conversations" | "reminders";

const CHATS_PATH = "/chats";
const REMINDERS_PATH = "/chats/reminders";
const TAB_PATHS: Record<ChatsTab, string> = {
  conversations: CHATS_PATH,
  reminders: REMINDERS_PATH,
};

type ChatsPageProps = { tab: ChatsTab };

export default function ChatsPage({ tab }: ChatsPageProps): ReactNode {
  const rootRef = useRef<HTMLDivElement>(null);
  const isSplit = useIsSplit(rootRef);
  const navigate = useNavigate();
  const { search } = useLocation();
  const { id } = useParams();
  const openId = tab === "conversations" ? (id ?? null) : null;
  const counts = useQuery(countsQueries.detail());

  // The filter params (q, unread, with, page) ride along on open and close.
  function handleOpen(chatId: string): void {
    navigate({ pathname: `${CHATS_PATH}/${chatId}`, search });
  }

  function handleClose(): void {
    navigate({ pathname: CHATS_PATH, search });
  }

  function handleChangeTab(next: string): void {
    navigate(TAB_PATHS[next as ChatsTab]);
  }

  const needsAttention = counts.data?.needs_attention ?? 0;
  const unread = counts.data?.unread_chats ?? 0;

  let description: ReactNode;
  if (counts.isPending) {
    description = <Skeleton className="h-4 w-48 rounded-full" />;
  } else if (counts.data) {
    description = (
      <>
        <span className="tabular-nums">{unread}</span> unread ·{" "}
        <span className="tabular-nums">{needsAttention}</span> need attention
      </>
    );
  }

  const thread = openId && (
    <ChatThread
      key={openId}
      conversationId={openId}
      container={isSplit ? "pane" : "overlay"}
      onClose={handleClose}
    />
  );

  return (
    <div ref={rootRef}>
      <PageHeader
        title="Chats"
        description={description}
        tabs={
          <SubPageTabs
            label="Chats sections"
            activeId={tab}
            onChange={handleChangeTab}
            items={[
              {
                id: "conversations",
                label: "Conversations",
                count: unread > 0 ? unread : undefined,
              },
              { id: "reminders", label: "Reminders" },
            ]}
          />
        }
      >
        {tab === "conversations" && <ConversationsToolbar />}
      </PageHeader>

      {tab === "reminders" ? (
        <RemindersPanel />
      ) : (
        <>
          <div
            className={cn(
              CARD,
              "overflow-hidden @6xl:grid @6xl:h-[max(560px,calc(var(--kit-h)-290px))] @6xl:grid-cols-[minmax(300px,380px)_1fr]",
            )}
          >
            <div className="min-h-0 border-(--tl-border) @6xl:overflow-y-auto @6xl:border-r">
              <ConversationList openId={openId} onOpen={handleOpen} />
            </div>
            {isSplit && (
              <div className="min-h-0 overflow-y-auto bg-(--tl-canvas)/40">
                {thread || (
                  <div className="flex h-full items-center justify-center p-6">
                    <EmptyState
                      isBare
                      icon={MessageCircle}
                      title="Pick a chat"
                      body={
                        needsAttention > 0
                          ? `${needsAttention} need attention. They’re at the top of the list.`
                          : "Choose a chat on the left to read it and reply."
                      }
                    />
                  </div>
                )}
              </div>
            )}
          </div>
          {!isSplit && thread}
        </>
      )}
    </div>
  );
}
