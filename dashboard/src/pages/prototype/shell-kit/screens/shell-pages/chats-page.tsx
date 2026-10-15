// Chats: sub-page tabs Conversations / Reminders. Conversations shows
// who handles each chat (Bot or Taken over) and why it Needs attention.
import { useState } from "react";
import type { ReactNode } from "react";
import { BellRing, MessageCircle } from "lucide-react";
import {
  CHATS_UNREAD,
  CONVERSATIONS,
  GUARDIANS,
} from "@/pages/prototype/shell-kit/kit/mock-data";
import { CARD, cn, HEADING } from "@/pages/prototype/shell-kit/kit/tokens";
import {
  AttentionBadge,
  Avatar,
  ChatHandlerBadge,
  RemindersBadge,
} from "@/pages/prototype/shell-kit/kit/components/badges";
import { MultiSelectFilter } from "@/pages/prototype/shell-kit/kit/components/multi-select-filter";
import { useFilters } from "@/pages/prototype/shell-kit/kit/hooks/use-filters";
import { SubPageTabs } from "@/pages/prototype/shell-kit/kit/components/tabs";
import { PageHeader } from "@/pages/prototype/shell-kit/kit/shell/page-header";
import { PageToolbar } from "@/pages/prototype/shell-kit/kit/shell/page-toolbar";
import { EmptyState } from "@/pages/prototype/shell-kit/kit/states/states";

const HANDLER_OPTIONS = [
  { value: "Bot", label: "Bot" },
  { value: "Taken over", label: "Taken over" },
];

const ATTENTION_OPTIONS = [
  ...new Set(CONVERSATIONS.flatMap((chat) => (chat.attention ? [chat.attention] : []))),
].map((reason) => ({ value: reason, label: reason }));

export default function ChatsPage(): ReactNode {
  const [tab, setTab] = useState("conversations");
  const [query, setQuery] = useState("");
  const filters = useFilters({ handler: [], attention: [] });
  const attentionCount = CONVERSATIONS.filter((chat) => chat.attention).length;

  const needle = query.trim().toLowerCase();
  const visible = CONVERSATIONS.filter((chat) => {
    const isQueryMatch =
      needle === "" || chat.guardian.toLowerCase().includes(needle);
    const isFilterMatch =
      filters.matches("handler", chat.handler === "Bot" ? "Bot" : "Taken over") &&
      filters.matches("attention", chat.attention ? [chat.attention] : []);
    return isQueryMatch && isFilterMatch;
  });

  return (
    <>
      <PageHeader
        title="Chats"
        description={`${CHATS_UNREAD} unread, ${attentionCount} need attention.`}
        tabs={
          <SubPageTabs
            label="Chats sections"
            activeId={tab}
            onChange={setTab}
            items={[
              { id: "conversations", label: "Conversations", count: CHATS_UNREAD },
              { id: "reminders", label: "Reminders" },
            ]}
          />
        }
      >
        {tab === "conversations" && (
          <PageToolbar
            searchLabel="Search chats"
            searchPlaceholder="Search a Guardian"
            query={query}
            onQueryChange={setQuery}
            activeFilterCount={filters.activeCount}
            onClearFilters={filters.clearAll}
            filters={
              <>
                <MultiSelectFilter
                  label="Needs attention"
                  options={ATTENTION_OPTIONS}
                  selected={filters.selected.attention}
                  onChange={(values) => filters.set("attention", values)}
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
      {tab === "conversations" ? (
        <ConversationList chats={visible} />
      ) : (
        <RemindersPanel />
      )}
    </>
  );
}

type ConversationListProps = { chats: typeof CONVERSATIONS };

function ConversationList({ chats }: ConversationListProps): ReactNode {
  if (chats.length === 0) {
    return (
      <EmptyState
        icon={MessageCircle}
        title="No chats match"
        body="Try another name or turn off the filter."
      />
    );
  }
  return (
    <ul className={cn(CARD, "divide-y divide-(--tl-border) overflow-hidden")}>
      {chats.map((chat) => (
        <li key={chat.id}>
          <button
            type="button"
            className="flex min-h-[76px] w-full cursor-pointer items-start gap-3 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-(--tl-tint) focus-visible:-outline-offset-2 @2xl:px-5"
          >
            <Avatar name={chat.guardian} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-3">
                <span
                  className={cn(
                    "truncate text-[15px] leading-6",
                    chat.unread > 0 ? "font-bold" : "font-semibold",
                  )}
                >
                  {chat.guardian}
                </span>
                <span className="shrink-0 text-[13px] text-(--tl-muted) tabular-nums">
                  {chat.at}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-[14px] leading-5",
                    chat.unread > 0
                      ? "font-medium text-(--tl-ink)"
                      : "text-(--tl-muted)",
                  )}
                >
                  {chat.preview}
                </span>
                {chat.unread > 0 && (
                  <span className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-(--tl-primary) px-2 text-[12px] font-semibold text-(--tl-on-primary) tabular-nums">
                    {chat.unread}
                    <span className="sr-only"> unread</span>
                  </span>
                )}
              </span>
              <span className="mt-2 flex flex-wrap gap-1.5">
                <ChatHandlerBadge handler={chat.handler} />
                {chat.attention && <AttentionBadge reason={chat.attention} />}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function RemindersPanel(): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <section className={cn(CARD, "flex flex-col gap-4 p-5 @2xl:flex-row @2xl:items-center @2xl:p-6")}>
        <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-(--tl-yellow-tint) text-(--tl-yellow-ink)">
          <BellRing aria-hidden className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className={HEADING}>Next Booking reminders: Sunday, 5:00 PM</h2>
          <p className="text-[14px] leading-5 text-(--tl-muted)">
            Goes to Guardians with Reminders on and no session booked next
            week. 3 will get one.
          </p>
        </div>
      </section>
      <ul className={cn(CARD, "divide-y divide-(--tl-border) overflow-hidden")}>
        {GUARDIANS.map((guardian) => (
          <li
            key={guardian.id}
            className="flex min-h-[72px] items-center gap-3 px-4 py-3 @2xl:px-5"
          >
            <Avatar name={guardian.name} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold">
                {guardian.name}
              </span>
              <span className="block truncate text-[13px] text-(--tl-muted)">
                {guardian.language} · {guardian.children.join(", ")}
              </span>
            </span>
            <RemindersBadge state={guardian.reminders} />
          </li>
        ))}
      </ul>
    </div>
  );
}
