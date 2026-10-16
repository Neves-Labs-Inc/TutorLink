// A chat that Needs attention. The whole row opens the chat. While the
// 24h window is open it says how long Takeover has left; once closed,
// the Office must reach the Guardian outside the bot, so the row shows
// their phone and a Mark done beside it (TutorLink#189).
import type { ReactNode } from "react";
import { Check, ChevronRight, Clock, Phone, UserRound } from "lucide-react";
import { AttentionBadge } from "@/components/kit/components/badges";
import { Button } from "@/components/kit/components/button";
import { cn } from "@/components/kit/tokens";
import {
  FLAG_REASON_LABEL,
  formatPhone,
  formatWindowLeft,
  getDisplayName,
  getTakeoverWindow,
} from "@/pages/prototype/home/lib/labels";
import type { ConversationSummary } from "@/pages/prototype/home/types/api";

// Under this, the countdown turns to the warning tone.
const URGENT_MINUTES = 120;

type ChatTodoRowProps = {
  chat: ConversationSummary;
  currentUserId: string;
  isMarking: boolean;
  onOpen: (chat: ConversationSummary) => void;
  onMarkDone: (chat: ConversationSummary) => void;
};

export default function ChatTodoRow({
  chat,
  currentUserId,
  isMarking,
  onOpen,
  onMarkDone,
}: ChatTodoRowProps): ReactNode {
  const takeover = getTakeoverWindow(chat);
  const name = getDisplayName(chat);
  const isUrgent = takeover.isOpen && takeover.minutesLeft < URGENT_MINUTES;

  return (
    <li className="border-b border-(--tl-border) py-1 last:border-b-0">
      <button
        type="button"
        onClick={() => onOpen(chat)}
        aria-label={`Open chat with ${name}`}
        className="group flex min-h-14 w-full cursor-pointer items-start gap-3 rounded-[14px] px-2 py-2.5 text-left transition-colors duration-150 hover:bg-(--tl-tint) active:bg-(--tl-tint-strong)"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[15px] leading-6 font-semibold">
              {name}
            </span>
            {chat.flag_reason && (
              <AttentionBadge reason={FLAG_REASON_LABEL[chat.flag_reason]} />
            )}
          </span>
          {chat.last_message_preview && (
            <span className="mt-0.5 line-clamp-1 text-[13px] leading-[18px] text-(--tl-muted)">
              “{chat.last_message_preview}”
            </span>
          )}
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-[18px] font-medium">
            {takeover.isOpen ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 tabular-nums",
                  isUrgent ? "text-(--tl-warning)" : "text-(--tl-ink-soft)",
                )}
              >
                <Clock aria-hidden className="size-3.5" />
                {formatWindowLeft(takeover.minutesLeft)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-(--tl-danger)">
                <Phone aria-hidden className="size-3.5" />
                Reply outside the bot
              </span>
            )}
            {chat.taken_over_by && (
              <span className="inline-flex items-center gap-1 text-(--tl-primary-ink)">
                <UserRound aria-hidden className="size-3.5" />
                {chat.taken_over_by.id === currentUserId
                  ? "Taken over by you"
                  : `Taken over by ${chat.taken_over_by.name.split(" ")[0]}`}
              </span>
            )}
          </span>
        </span>
        <ChevronRight
          aria-hidden
          className="mt-1 size-5 shrink-0 text-(--tl-muted) transition-transform duration-150 group-hover:translate-x-0.5"
        />
      </button>
      {!takeover.isOpen && (
        <div className="flex flex-wrap items-center gap-2 px-2 pb-2">
          <a
            href={`tel:${chat.phone_number}`}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-(--tl-border) bg-(--tl-surface) px-4 text-[14px] font-medium tabular-nums transition-colors duration-150 hover:bg-(--tl-tint)"
          >
            <Phone aria-hidden className="size-[18px]" />
            {formatPhone(chat.phone_number)}
          </a>
          <Button
            variant="soft"
            icon={Check}
            isLoading={isMarking}
            onClick={() => onMarkDone(chat)}
            aria-label={`Mark done: chat with ${name}`}
          >
            Mark done
          </Button>
        </div>
      )}
    </li>
  );
}
