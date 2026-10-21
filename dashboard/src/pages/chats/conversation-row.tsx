import type { ReactNode } from "react";
import { UserRoundPlus } from "lucide-react";
import {
  AttentionBadge,
  Avatar,
  Badge,
  ChatHandlerBadge,
} from "@/components/kit/components/badges";
import { ReplyWindowCue } from "@/components/kit/components/reply-window-cue";
import { cn } from "@/components/kit/tokens";
import { FLAG_REASON_LABEL, getChatTitle } from "@/lib/chats/labels";
import { formatListTime } from "@/lib/chats/time";
import type { Conversation } from "@/lib/queries/conversations";

type ConversationRowProps = {
  chat: Conversation;
  meId: string | null;
  nowMs: number;
  isSelected: boolean;
  onOpen: (id: string) => void;
};

// One chat in the list: the whole row is a single button that opens it.
export function ConversationRow({
  chat,
  meId,
  nowMs,
  isSelected,
  onOpen,
}: ConversationRowProps): ReactNode {
  const holder = chat.taken_over_by;
  const isMine = holder !== null && holder.id === meId;
  // Only flagged chats and your own takeovers race the 24-hour window.
  const isWindowShown = chat.flag_reason !== null || isMine;

  return (
    <li className="relative">
      {/* The inset ring is important: kit.css's unlayered :focus-visible
          offset beats utilities, and the card clips an outside ring. */}
      <button
        type="button"
        onClick={() => onOpen(chat.id)}
        aria-current={isSelected ? "true" : undefined}
        className={cn(
          "flex min-h-[76px] w-full cursor-pointer items-start gap-3 px-4 py-3.5 text-left transition-colors duration-150 focus-visible:-outline-offset-2! @2xl:px-5",
          isSelected
            ? "bg-(--tl-tint-strong)"
            : "hover:bg-(--tl-tint) active:bg-(--tl-tint-strong)",
        )}
      >
        {isSelected && (
          <span
            aria-hidden
            className="absolute inset-y-2 left-0 w-1 rounded-full bg-(--tl-primary)"
          />
        )}
        <Avatar name={chat.guardian?.name ?? null} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span
              className={cn(
                "truncate text-[15px] leading-6 text-(--tl-ink)",
                chat.unread ? "font-bold" : "font-semibold",
              )}
            >
              {getChatTitle(chat.guardian, chat.phone_number)}
            </span>
            <span
              className={cn(
                "shrink-0 text-[13px] tabular-nums",
                chat.unread
                  ? "font-semibold text-(--tl-primary-ink)"
                  : "text-(--tl-muted)",
              )}
            >
              {formatListTime(chat.last_message_at, nowMs)}
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
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 empty:hidden">
            {chat.flag_reason && (
              <AttentionBadge reason={FLAG_REASON_LABEL[chat.flag_reason]} />
            )}
            {chat.intake_in_progress && (
              <Badge tone="yellow" icon={UserRoundPlus}>
                Intake in progress
              </Badge>
            )}
            {holder && (
              <ChatHandlerBadge handler={holder.name} isYou={isMine} />
            )}
            {isWindowShown && (
              <ReplyWindowCue
                lastClientMessageAt={chat.last_client_message_at}
                isTakenOverByYou={isMine}
              />
            )}
          </span>
        </span>
      </button>
    </li>
  );
}
