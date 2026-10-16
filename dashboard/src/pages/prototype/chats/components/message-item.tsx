// One line in a thread. The Guardian is on the left; everything the
// Guardian receives (bot and office replies) is on the right, labelled
// by who wrote it. System lines sit in the middle as quiet notices.
import type { ReactNode } from "react";
import {
  ArrowLeftRight,
  BellRing,
  Bot,
  Check,
  CheckCheck,
  CircleAlert,
  Clock,
  Hand,
  NotebookPen,
  RotateCw,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/pages/prototype/shell-kit/kit/tokens";
import { TextLink } from "@/pages/prototype/shell-kit/kit/components/button";
import type {
  MessageRead,
  MessageStatus,
  SystemMessageKind,
} from "@/pages/prototype/chats/types/api";
import { getSendErrorLabel } from "@/pages/prototype/chats/lib/labels";
import { formatClockTime } from "@/pages/prototype/chats/lib/time";

type MessageItemProps = {
  message: MessageRead;
  meId: string;
  onRetry: (messageId: string) => void;
  canRetry: boolean;
};

export default function MessageItem({
  message,
  meId,
  onRetry,
  canRetry,
}: MessageItemProps): ReactNode {
  if (message.author_kind === "system") {
    return <SystemLine message={message} onRetry={onRetry} canRetry={canRetry} />;
  }
  const isInbound = message.author_kind === "client";
  const isBot = message.author_kind === "bot";
  const isFailed = message.status === "failed";
  let author = "Guardian";
  if (isBot) {
    author = "Bot";
  } else if (message.author) {
    author = message.author.id === meId ? "You" : message.author.name.split(" ")[0];
  }

  return (
    <li
      className={cn(
        "flex flex-col gap-1",
        isInbound ? "items-start pr-10 @2xl:pr-16" : "items-end pl-10 @2xl:pl-16",
      )}
    >
      {!isInbound && (
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
          "max-w-full rounded-[20px] px-4 py-2.5 text-[15px] leading-6 break-words whitespace-pre-wrap",
          isInbound &&
            "rounded-bl-[6px] border border-(--tl-card-border) bg-(--tl-surface)",
          isBot && "rounded-br-[6px] bg-(--tl-surface-sunk) text-(--tl-ink-soft)",
          !isInbound &&
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
        {!isInbound && !isBot && <DeliveryMark status={message.status} />}
      </span>
      {isFailed && (
        <span
          role="note"
          className="flex items-center gap-1.5 px-1 text-[13px] font-medium text-(--tl-danger)"
        >
          <CircleAlert aria-hidden className="size-4" />
          {getSendErrorLabel(message.error_code)}
        </span>
      )}
    </li>
  );
}

const DELIVERY: Record<
  Exclude<MessageStatus, "received">,
  { icon: LucideIcon; label: string }
> = {
  queued: { icon: Clock, label: "Sending" },
  sent: { icon: Check, label: "Sent" },
  delivered: { icon: CheckCheck, label: "Delivered" },
  failed: { icon: CircleAlert, label: "Not sent" },
};

function DeliveryMark({ status }: { status: MessageStatus }): ReactNode {
  if (status === "received") return null;
  const { icon: Icon, label } = DELIVERY[status];
  return (
    <span className="inline-flex items-center gap-1">
      <Icon aria-hidden className="size-3.5" />
      {label}
    </span>
  );
}

const SYSTEM_STYLE: Record<
  SystemMessageKind,
  { icon: LucideIcon; label: string; isStaffOnly?: boolean }
> = {
  takeover_notice: { icon: Hand, label: "Taken over" },
  transfer_notice: { icon: ArrowLeftRight, label: "Taken over" },
  handback_notice: { icon: Bot, label: "Handed back to the bot" },
  booking_reminder: { icon: BellRing, label: "Booking reminder" },
  consent_notice: { icon: ShieldCheck, label: "Reminders" },
  number_change_note: {
    icon: NotebookPen,
    label: "Office note",
    isStaffOnly: true,
  },
};

type SystemLineProps = {
  message: MessageRead;
  onRetry: (messageId: string) => void;
  canRetry: boolean;
};

function SystemLine({ message, onRetry, canRetry }: SystemLineProps): ReactNode {
  const kind = message.system_kind ?? "takeover_notice";
  const style = SYSTEM_STYLE[kind];
  const Icon = style.icon;
  const isFailed = message.status === "failed";
  const children = message.reminder_child_names;
  return (
    <li className="flex justify-center px-2">
      <div
        className={cn(
          "flex max-w-[52ch] flex-col items-center gap-1 rounded-[18px] px-4 py-2.5 text-center",
          style.isStaffOnly
            ? "bg-(--tl-yellow-tint) text-(--tl-yellow-ink)"
            : "bg-(--tl-surface-sunk) text-(--tl-ink-soft)",
          isFailed && "ring-2 ring-(--tl-danger)",
        )}
      >
        <span className="flex items-center gap-1.5 text-[12px] font-semibold">
          <Icon aria-hidden className="size-3.5" />
          {style.label}
          {children && ` for ${children.join(" and ")}`}
          <span className="font-normal opacity-80">
            · {formatClockTime(message.created_at)}
          </span>
        </span>
        <span className="text-[14px] leading-5">
          {style.isStaffOnly ? (
            message.body
          ) : (
            <>
              <span className="sr-only">Sent to the Guardian: </span>“
              {message.body}”
            </>
          )}
        </span>
        {style.isStaffOnly && (
          <span className="text-[12px] opacity-80">
            Only the office sees this.
          </span>
        )}
        {isFailed && (
          <span className="flex flex-wrap items-center justify-center gap-x-3 text-[13px] font-medium text-(--tl-danger)">
            {getSendErrorLabel(message.error_code)}
            {canRetry && (
              <TextLink onClick={() => onRetry(message.id)}>
                <RotateCw aria-hidden className="size-4" />
                Retry
              </TextLink>
            )}
          </span>
        )}
      </div>
    </li>
  );
}
