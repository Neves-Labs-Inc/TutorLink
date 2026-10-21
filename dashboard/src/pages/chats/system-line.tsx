// A centred notice in the thread: what was sent to the Guardian on the
// office's behalf, or a Staff-only note the Guardian never sees.
import type { ReactNode } from "react";
import {
  ArrowLeftRight,
  BellRing,
  Bot,
  ClipboardList,
  Hand,
  LoaderCircle,
  NotebookPen,
  RotateCw,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { TextLink } from "@/components/kit/components/button";
import { cn } from "@/components/kit/tokens";
import type { NoticeRetry } from "@/hooks/use-notice-retry";
import { joinNames } from "@/lib/chatThread";
import { getSendErrorLabel } from "@/lib/chats/labels";
import { formatClockTime } from "@/lib/chats/time";
import type { Message, SystemMessageKind } from "@/lib/queries/conversations";

type SystemStyle = { icon: LucideIcon; label: string; isStaffOnly?: boolean };

const SYSTEM_STYLE: Record<SystemMessageKind, SystemStyle> = {
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
  handoff_note: {
    icon: ClipboardList,
    label: "Bot’s handoff note",
    isStaffOnly: true,
  },
};

const RETRYABLE: SystemMessageKind[] = ["takeover_notice", "transfer_notice"];

type SystemLineProps = {
  message: Message;
  isWindowOpen: boolean;
  isLive: boolean;
  noticeRetry: NoticeRetry;
};

export default function SystemLine({
  message,
  isWindowOpen,
  isLive,
  noticeRetry,
}: SystemLineProps): ReactNode {
  const kind = message.system_kind ?? "takeover_notice";
  const style = SYSTEM_STYLE[kind];
  const Icon = style.icon;
  // Staff-only lines are never sent, so they never fail or retry.
  const isFailed = message.status === "failed" && !style.isStaffOnly;
  // The API refuses a retry outside the window too.
  // An unknown kind (null) never offers Retry.
  const canRetry =
    isFailed &&
    isWindowOpen &&
    message.system_kind !== null &&
    RETRYABLE.includes(message.system_kind);
  const isRetrying = noticeRetry.pendingId === message.id;
  const RetryIcon = isRetrying ? LoaderCircle : RotateCw;
  const children = message.reminder_child_names ?? [];

  return (
    <li
      data-message={message.id}
      className={cn(
        "flex flex-col items-center gap-1.5 px-2",
        isLive && "kit-rise motion-reduce:animate-none",
      )}
    >
      <div
        className={cn(
          "flex max-w-[52ch] flex-col items-center gap-1 rounded-[18px] px-4 py-2.5 text-center",
          style.isStaffOnly
            ? "bg-(--tl-yellow-tint) text-(--tl-yellow-ink)"
            : "bg-(--tl-surface-sunk) text-(--tl-ink-soft)",
          isFailed && "ring-2 ring-(--tl-danger)",
        )}
      >
        <span className="flex flex-wrap items-center justify-center gap-x-1.5 text-[12px] font-semibold">
          <Icon aria-hidden className="size-3.5" />
          {style.label}
          {kind === "booking_reminder" &&
            children.length > 0 &&
            ` for ${joinNames(children)}`}
          <span className="font-normal">
            · {formatClockTime(message.created_at)}
          </span>
        </span>
        <span className="text-[14px] leading-5 break-words whitespace-pre-wrap">
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
          <span className="text-[12px]">Only the office sees this.</span>
        )}
        {isFailed && (
          <span className="kit-fade flex flex-wrap items-center justify-center gap-x-3 text-[13px] font-medium text-(--tl-danger)">
            {getSendErrorLabel(message.error_code)}
            {canRetry && (
              <TextLink
                disabled={isRetrying}
                onClick={() => noticeRetry.retry(message.id)}
              >
                <RetryIcon
                  aria-hidden
                  className={cn("size-4", isRetrying && "kit-spin")}
                />
                Retry
              </TextLink>
            )}
          </span>
        )}
      </div>
      {noticeRetry.failedId === message.id && (
        <p
          role="alert"
          className="kit-fade text-[13px] font-medium text-(--tl-danger)"
        >
          Couldn’t send it again. Check the chat and try again.
        </p>
      )}
    </li>
  );
}
