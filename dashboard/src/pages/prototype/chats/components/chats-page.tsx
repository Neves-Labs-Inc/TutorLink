// Chats inside the app shell: sub-page tabs Conversations | Reminders.
// Conversations (decided: layout A): from ~860px of page width the
// list and chat sit side by side, like WhatsApp Web; narrower, the chat
// pushes in from the right as a full page.
import { useState } from "react";
import type { ReactNode } from "react";
import { CircleDot, MessageCircle, MessagesSquare } from "lucide-react";
import { MultiSelectFilter } from "@/components/kit/components/multi-select-filter";
import { QuickFilter } from "@/components/kit/components/quick-filter";
import { SubPageTabs } from "@/components/kit/components/tabs";
import { useFilters } from "@/components/kit/hooks/use-filters";
import type { Role } from "@/pages/prototype/shared/mock-data";
import { useToast } from "@/components/kit/overlays/use-toast";
import { PageHeader } from "@/components/kit/shell/page-header";
import { PageToolbar } from "@/components/kit/shell/page-toolbar";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/kit/states/states";
import { CARD, cn } from "@/components/kit/tokens";
import type { ChatsApi } from "@/pages/prototype/chats/hooks/use-chats";
import { useElementWidth } from "@/pages/prototype/chats/hooks/use-element-width";
import { useSimulatedLoad } from "@/pages/prototype/chats/hooks/use-simulated-load";
import type { Load } from "@/pages/prototype/chats/hooks/use-simulated-load";
import { getWindowState } from "@/pages/prototype/chats/lib/time";
import type { WindowState } from "@/pages/prototype/chats/lib/time";
import {
  emptyWeek,
  REMINDER_WEEKS,
  WEEK_ORDER,
  withRemindersState,
} from "@/pages/prototype/chats/mock/reminders-mock";
import type { RemindersState } from "@/pages/prototype/chats/types/api";
import ChatThread from "@/pages/prototype/chats/components/chat-thread";
import ConversationList from "@/pages/prototype/chats/components/conversation-list";
import RemindersPanel from "@/pages/prototype/chats/components/reminders-panel";

// Below this page width the list and chat can't share a row.
const SPLIT_MIN_WIDTH = 860;

export type ChatsTab = "conversations" | "reminders";
export type DataState = "populated" | "loading" | "empty" | "error";

type ChatsPageProps = {
  role: Role;
  chats: ChatsApi;
  meId: string;
  dataState: DataState;
  initialTab: ChatsTab;
  initialOpenId: string | null;
  initialWeek: string;
  remindersState: RemindersState;
};

const HANDLER_OPTIONS = [
  { value: "bot", label: "Bot" },
  { value: "mine", label: "Taken over by you" },
  { value: "others", label: "Taken over by others" },
];

function toLoad(dataState: DataState): Load {
  if (dataState === "loading") return "loading";
  if (dataState === "error") return "error";
  return "ready";
}

export default function ChatsPage({
  role,
  chats,
  meId,
  dataState,
  initialTab,
  initialOpenId,
  initialWeek,
  remindersState,
}: ChatsPageProps): ReactNode {
  const { showToast } = useToast();
  const [rootRef, width] = useElementWidth<HTMLDivElement>();
  const [tab, setTab] = useState<ChatsTab>(initialTab);
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [query, setQuery] = useState("");
  const [isUnreadOnly, setIsUnreadOnly] = useState(false);
  const [weekIndex, setWeekIndex] = useState(WEEK_ORDER.indexOf(initialWeek));
  const filters = useFilters({ handler: [] });
  const [load, retryLoad] = useSimulatedLoad(toLoad(dataState));
  const isEmpty = dataState === "empty";
  const isSplit = width >= SPLIT_MIN_WIDTH;
  const { counts } = chats;

  const summaries = isEmpty ? [] : chats.summaries;
  const needle = query.trim().toLowerCase();
  const visible = summaries.filter((chat) => {
    const handler =
      chat.taken_over_by === null
        ? "bot"
        : chat.taken_over_by.id === meId
          ? "mine"
          : "others";
    const haystack = `${chat.guardian?.name ?? ""} ${chat.phone_number}`.toLowerCase();
    return (
      (needle === "" || haystack.includes(needle)) &&
      filters.matches("handler", handler) &&
      (!isUnreadOnly || chat.unread)
    );
  });
  // Not on ConversationSummary yet (see the note on Needs attention).
  const windows: Record<string, WindowState> = Object.fromEntries(
    summaries.map((chat) => [
      chat.id,
      getWindowState(chats.getConversation(chat.id)?.last_client_message_at ?? null),
    ]),
  );

  function handleOpen(id: string): void {
    setOpenId(id);
    chats.markRead(id);
  }

  function handleOpenGuardianChat(guardianId: string, name: string): void {
    const match = chats.summaries.find((chat) => chat.guardian?.id === guardianId);
    if (!match) {
      showToast({ tone: "info", message: `${name} has no chat in this mock.` });
      return;
    }
    setTab("conversations");
    handleOpen(match.id);
  }

  const week = REMINDER_WEEKS[WEEK_ORDER[weekIndex]];
  const shownWeek = withRemindersState(isEmpty ? emptyWeek(week) : week, remindersState);
  const unread = isEmpty ? 0 : counts.unread_chats;
  const attention = isEmpty ? 0 : counts.needs_attention;

  const hasFilters = filters.activeCount > 0 || isUnreadOnly || needle !== "";
  let list: ReactNode = (
    <ConversationList
      summaries={visible}
      windows={windows}
      selectedId={isSplit ? openId : null}
      meId={meId}
      onOpen={handleOpen}
      isCompact={isSplit}
    />
  );
  if (load === "loading") {
    list = <ListSkeleton rows={5} label="Loading chats" />;
  } else if (load === "error") {
    list = (
      <ErrorState
        title="Chats didn't load"
        body="Check your connection and try again."
        onRetry={retryLoad}
      />
    );
  } else if (summaries.length === 0) {
    list = (
      <EmptyState
        isBare={isSplit}
        icon={MessagesSquare}
        title="No chats yet"
        body="When a Guardian messages the WhatsApp number, their chat shows up here."
      />
    );
  } else if (visible.length === 0) {
    list = (
      <EmptyState
        isBare={isSplit}
        icon={MessageCircle}
        title="No chats match"
        body="Try another name or number, or clear the filters."
      />
    );
  }
  const isListBare = load === "ready" && visible.length > 0;

  const thread = openId && !isEmpty && load !== "error" && (
    <ChatThread
      key={openId}
      chats={chats}
      conversationId={openId}
      meId={meId}
      load={load === "loading" ? "loading" : "ready"}
      container={isSplit ? "pane" : "overlay"}
      onClose={() => setOpenId(null)}
      onRetryLoad={retryLoad}
    />
  );

  return (
    <div ref={rootRef}>
      <PageHeader
        title="Chats"
        description={
          load === "ready"
            ? `${unread} unread · ${attention} need attention`
            : undefined
        }
        tabs={
          <SubPageTabs
            label="Chats sections"
            activeId={tab}
            onChange={(id) => setTab(id as ChatsTab)}
            items={[
              { id: "conversations", label: "Conversations", count: unread },
              { id: "reminders", label: "Reminders" },
            ]}
          />
        }
      >
        {tab === "conversations" && (
          <PageToolbar
            searchLabel="Search chats"
            searchPlaceholder="Search a Guardian or number"
            query={query}
            onQueryChange={setQuery}
            activeFilterCount={filters.activeCount + (isUnreadOnly ? 1 : 0)}
            onClearFilters={() => {
              filters.clearAll();
              setIsUnreadOnly(false);
            }}
            filters={
              <>
                <QuickFilter
                  label="Unread"
                  icon={CircleDot}
                  isOn={isUnreadOnly}
                  onToggle={() => setIsUnreadOnly((current) => !current)}
                />
                <MultiSelectFilter
                  label="Handled by"
                  options={HANDLER_OPTIONS}
                  selected={filters.selected.handler}
                  onChange={(values) => filters.set("handler", values)}
                />
              </>
            }
          />
        )}
      </PageHeader>

      {tab === "reminders" ? (
        <RemindersPanel
          role={role}
          week={shownWeek}
          load={load}
          canGoBack={weekIndex > 0}
          canGoForward={weekIndex < WEEK_ORDER.length - 1}
          onStep={(step) => setWeekIndex((current) => current + step)}
          onOpenGuardianChat={handleOpenGuardianChat}
          onOpenSettings={() =>
            showToast({ tone: "info", message: "Settings is its own prototype." })
          }
          onRetryLoad={retryLoad}
        />
      ) : isSplit ? (
        <div
          className={cn(
            CARD,
            "grid h-[max(560px,calc(var(--kit-h)-290px))] grid-cols-[minmax(300px,380px)_1fr] overflow-hidden",
          )}
        >
          <div className="min-h-0 overflow-y-auto border-r border-(--tl-border)">
            <div className={cn(!isListBare && "p-4")}>{list}</div>
          </div>
          <div className="min-h-0 bg-(--tl-canvas)/40">
            {thread || (
              <div className="flex h-full items-center justify-center p-6">
                <EmptyState
                  isBare
                  icon={MessageCircle}
                  title={load === "error" ? "Nothing to show" : "Pick a chat"}
                  body={
                    attention > 0
                      ? `${attention} need attention. They're at the top of the list.`
                      : "Choose a chat on the left to read it and reply."
                  }
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className={cn(isListBare && cn(CARD, "overflow-hidden"))}>{list}</div>
          {thread}
        </>
      )}
      {hasFilters && load === "ready" && visible.length > 0 && (
        <p className="sr-only" role="status">
          {visible.length} chats shown
        </p>
      )}
    </div>
  );
}
