// The Conversations list, in two sections: Needs attention first (the
// chat closest to losing its 24-hour window on top, closed windows at
// the bottom, as in Home's To do), then every other chat, newest first.
// The whole row opens the chat.
import type { ReactNode } from "react";
import { cn, EYEBROW } from "@/pages/prototype/shell-kit/kit/tokens";
import { AttentionBadge } from "@/pages/prototype/shell-kit/kit/components/badges";
import type { ConversationSummary } from "@/pages/prototype/chats/types/api";
import { FLAG_LABEL, getChatTitle } from "@/pages/prototype/chats/lib/labels";
import { formatListTime } from "@/pages/prototype/chats/lib/time";
import type { WindowState } from "@/pages/prototype/chats/lib/time";
import {
  GuardianAvatar,
  HolderBadge,
  NewNumberBadge,
  WindowCue,
} from "@/pages/prototype/chats/components/chat-badges";
import PrototypeNote from "@/pages/prototype/chats/components/prototype-note";

type ConversationListProps = {
  summaries: ConversationSummary[];
  windows: Record<string, WindowState>;
  selectedId: string | null;
  meId: string;
  onOpen: (id: string) => void;
  isCompact?: boolean;
};

function getWindowRank(replyWindow: WindowState | undefined): number {
  return replyWindow?.isOpen ? replyWindow.msLeft : Number.MAX_SAFE_INTEGER;
}

export default function ConversationList({
  summaries,
  windows,
  selectedId,
  meId,
  onOpen,
  isCompact = false,
}: ConversationListProps): ReactNode {
  const flagged = summaries
    .filter((chat) => chat.flag_reason)
    .sort((a, b) => getWindowRank(windows[a.id]) - getWindowRank(windows[b.id]));
  const others = summaries.filter((chat) => !chat.flag_reason);

  return (
    <div className="flex flex-col">
      {flagged.length > 0 && (
        <Section
          title="Needs attention"
          count={flagged.length}
          isCompact={isCompact}
          note="ConversationSummary has no last_client_message_at or window field, so the list can't show “Takeover closes in…” or sort by it yet. API gap."
        >
          {flagged.map((chat) => (
            <Row
              key={chat.id}
              chat={chat}
              replyWindow={windows[chat.id]}
              isSelected={chat.id === selectedId}
              meId={meId}
              onOpen={onOpen}
            />
          ))}
        </Section>
      )}
      {others.length > 0 && (
        <Section
          title={flagged.length > 0 ? "Other chats" : "All chats"}
          count={others.length}
          isCompact={isCompact}
        >
          {others.map((chat) => (
            <Row
              key={chat.id}
              chat={chat}
              replyWindow={windows[chat.id]}
              isSelected={chat.id === selectedId}
              meId={meId}
              onOpen={onOpen}
            />
          ))}
        </Section>
      )}
    </div>
  );
}

type SectionProps = {
  title: string;
  note?: string;
  count: number;
  isCompact: boolean;
  children: ReactNode;
};

function Section({
  title,
  note,
  count,
  isCompact,
  children,
}: SectionProps): ReactNode {
  return (
    <section aria-label={title}>
      <h2
        className={cn(
          EYEBROW,
          "flex items-center gap-2 border-b border-(--tl-border) bg-(--tl-surface-sunk) py-2.5",
          isCompact ? "px-4" : "px-4 @2xl:px-5",
        )}
      >
        {title}
        <span className="tabular-nums">· {count}</span>
        {note && (
          <span className="ml-auto normal-case">
            <PrototypeNote note={note} />
          </span>
        )}
      </h2>
      <ul className="divide-y divide-(--tl-border)">{children}</ul>
    </section>
  );
}

type RowProps = {
  chat: ConversationSummary;
  replyWindow: WindowState | undefined;
  isSelected: boolean;
  meId: string;
  onOpen: (id: string) => void;
};

function Row({
  chat,
  replyWindow,
  isSelected,
  meId,
  onOpen,
}: RowProps): ReactNode {
  const title = getChatTitle(chat.guardian, chat.phone_number);
  const isMine = chat.taken_over_by?.id === meId;
  // Only flagged chats and your own takeovers race the 24-hour window.
  const isWindowShown = replyWindow && (chat.flag_reason !== null || isMine);
  return (
    <li className="relative">
      <button
        type="button"
        onClick={() => onOpen(chat.id)}
        aria-current={isSelected ? "true" : undefined}
        className={cn(
          "flex min-h-[76px] w-full cursor-pointer items-start gap-3 px-4 py-3.5 text-left transition-colors duration-150 focus-visible:-outline-offset-2 @2xl:px-5",
          isSelected ? "bg-(--tl-tint-strong)" : "hover:bg-(--tl-tint)",
        )}
      >
        {isSelected && (
          <span
            aria-hidden
            className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-(--tl-primary)"
          />
        )}
        <GuardianAvatar guardian={chat.guardian} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span
              className={cn(
                "truncate text-[15px] leading-6",
                chat.unread ? "font-bold" : "font-semibold",
              )}
            >
              {title}
            </span>
            <span
              className={cn(
                "shrink-0 text-[13px] tabular-nums",
                chat.unread
                  ? "font-semibold text-(--tl-primary-ink)"
                  : "text-(--tl-muted)",
              )}
            >
              {formatListTime(chat.last_message_at)}
            </span>
          </span>
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[14px] leading-5",
                chat.unread
                  ? "font-medium text-(--tl-ink)"
                  : "text-(--tl-muted)",
              )}
            >
              {chat.last_message_preview ?? "No messages yet"}
            </span>
            {chat.unread && (
              <span className="inline-flex size-2.5 shrink-0 rounded-full bg-(--tl-primary)">
                <span className="sr-only">Unread</span>
              </span>
            )}
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {chat.flag_reason && (
              <AttentionBadge reason={FLAG_LABEL[chat.flag_reason]} />
            )}
            {chat.guardian === null && <NewNumberBadge />}
            <HolderBadge
              status={chat.status}
              holder={chat.taken_over_by}
              meId={meId}
              isBotShown={false}
            />
            {isWindowShown && (
              <WindowCue replyWindow={replyWindow} isTakenOverByMe={isMine} />
            )}
          </span>
        </span>
      </button>
    </li>
  );
}
