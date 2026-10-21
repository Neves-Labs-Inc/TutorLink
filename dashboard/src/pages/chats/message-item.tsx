// One Guardian, bot or office message. The Guardian is on the left;
// everything the Guardian receives is on the right, labelled by who
// wrote it. Bodies are plain text: React escapes them, never HTML.
import type { ReactNode } from "react";
import {
  Bot,
  Check,
  CheckCheck,
  CircleAlert,
  Clock,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/components/kit/tokens";
import { getFirstName, getSendErrorLabel } from "@/lib/chats/labels";
import { formatClockTime } from "@/lib/chats/time";
import type { Message, MessageStatus } from "@/lib/queries/conversations";

type DeliveryMark = { icon: LucideIcon; label: string; className?: string };

const DELIVERY_MARKS: Partial<Record<MessageStatus, DeliveryMark>> = {
  queued: { icon: Clock, label: "Sending" },
  sent: { icon: Check, label: "Sent" },
  delivered: { icon: CheckCheck, label: "Delivered" },
  read: { icon: CheckCheck, label: "Read", className: "text-(--tl-link)" },
  failed: { icon: CircleAlert, label: "Not sent", className: "text-(--tl-danger)" },
};

function getAuthor(message: Message, currentUserId: string | null): string {
  let author = "Guardian";
  if (message.author_kind === "bot") {
    author = "Bot";
  } else if (message.author_kind === "admin") {
    const isYou = message.author !== null && message.author.id === currentUserId;
    author = isYou ? "You" : getFirstName(message.author?.name ?? "Staff");
  }
  return author;
}

type MessageItemProps = {
  message: Message;
  currentUserId: string | null;
  isLive: boolean;
};

export default function MessageItem({
  message,
  currentUserId,
  isLive,
}: MessageItemProps): ReactNode {
  const isGuardian = message.author_kind === "client";
  const isBot = message.author_kind === "bot";
  const isFailed = message.status === "failed";
  const author = getAuthor(message, currentUserId);
  // Bot replies only show a mark when they failed; office replies always.
  const mark = isGuardian || (isBot && !isFailed)
    ? null
    : (DELIVERY_MARKS[message.status] ?? null);
  const MarkIcon = mark?.icon;

  return (
    <li
      data-message={message.id}
      className={cn(
        "flex flex-col gap-1",
        isGuardian ? "items-start pr-10 @2xl:pr-16" : "items-end pl-10 @2xl:pl-16",
        isLive && "kit-rise motion-reduce:animate-none",
      )}
    >
      {!isGuardian && (
        <span className="flex items-center gap-1 px-1 text-[12px] font-semibold text-(--tl-muted)">
          {isBot ? (
            <Bot aria-hidden className="size-3.5" />
          ) : (
            <UserRound aria-hidden className="size-3.5" />
          )}
          {author}
        </span>
      )}
      <div
        className={cn(
          "max-w-full rounded-[20px] px-4 py-2.5 text-[15px] leading-6 break-words whitespace-pre-wrap transition-shadow duration-150",
          isGuardian &&
            "rounded-bl-[6px] border border-(--tl-card-border) bg-(--tl-surface)",
          isBot && "rounded-br-[6px] bg-(--tl-surface-sunk) text-(--tl-ink-soft)",
          !isGuardian &&
            !isBot &&
            "rounded-br-[6px] bg-(--tl-tint-strong) text-(--tl-ink)",
          isFailed && "ring-2 ring-(--tl-danger)",
        )}
      >
        <span className="sr-only">{author}: </span>
        {message.body}
      </div>
      <span className="flex items-center gap-1.5 px-1 text-[12px] text-(--tl-muted) tabular-nums">
        {formatClockTime(message.created_at)}
        {mark && MarkIcon && (
          <span className={cn("inline-flex items-center gap-1", mark.className)}>
            <MarkIcon aria-hidden className="size-3.5" />
            {mark.label}
          </span>
        )}
      </span>
      {isFailed && (
        <span className="kit-fade flex items-center gap-1.5 px-1 text-[13px] font-medium text-(--tl-danger)">
          <CircleAlert aria-hidden className="size-4 shrink-0" />
          {getSendErrorLabel(message.error_code)}
        </span>
      )}
    </li>
  );
}
