import type { ReactNode } from "react";
import { Clock, PhoneOff } from "lucide-react";
import { cn } from "@/components/kit/tokens";
import { useNow } from "@/components/kit/hooks/use-now";
import {
  formatTimeLeft,
  getReplyWindow,
  REPLY_WINDOW_URGENT_MS,
} from "@/components/kit/lib/reply-window";

type ReplyWindowCueProps = {
  lastClientMessageAt: string | null;
  isTakenOverByYou: boolean;
};

// "Takeover closes in 5h" while the bot holds the chat; "Replies close in 5h"
// once you're replying; "Reply outside the bot" after the 24 hours. Plain
// text on purpose: a countdown in a live region would be noise.
export function ReplyWindowCue({
  lastClientMessageAt,
  isTakenOverByYou,
}: ReplyWindowCueProps): ReactNode {
  const replyWindow = getReplyWindow(lastClientMessageAt, useNow());
  const base =
    "inline-flex h-7 items-center gap-1.5 whitespace-nowrap text-[13px] leading-[18px] tabular-nums transition-colors duration-150";

  if (!replyWindow.isOpen) {
    return (
      <span className={cn(base, "font-semibold text-(--tl-danger)")}>
        <PhoneOff aria-hidden className="size-3.5" />
        Reply outside the bot
      </span>
    );
  }
  const isUrgent = replyWindow.msLeft < REPLY_WINDOW_URGENT_MS;
  const verb = isTakenOverByYou ? "Replies close" : "Takeover closes";
  return (
    <span
      className={cn(
        base,
        isUrgent
          ? "font-semibold text-(--tl-warning)"
          : "font-medium text-(--tl-muted)",
      )}
    >
      <Clock aria-hidden className="size-3.5" />
      {verb} in {formatTimeLeft(replyWindow.msLeft)}
    </span>
  );
}
