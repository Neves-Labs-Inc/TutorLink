// Chat-only badges built on the kit's Badge. The kit's ChatHandlerBadge
// reads "Taken over · Maria"; CONTEXT.md says "Taken over by Maria", and
// the viewer's own chats say "by you", so Chats draws its own.
import type { ReactNode } from "react";
import { Bot, Clock, PhoneOff, UserRound, UserRoundPlus } from "lucide-react";
import { Avatar, Badge } from "@/components/kit/components/badges";
import { cn } from "@/components/kit/tokens";
import type {
  ConversationStatus,
  GuardianRef,
  UserRef,
} from "@/pages/prototype/chats/types/api";
import {
  formatDuration,
  WINDOW_URGENT_MS,
} from "@/pages/prototype/chats/lib/time";
import type { WindowState } from "@/pages/prototype/chats/lib/time";

type HolderBadgeProps = {
  status: ConversationStatus;
  holder: UserRef | null;
  meId: string;
  isBotShown?: boolean;
};

export function HolderBadge({
  status,
  holder,
  meId,
  isBotShown = true,
}: HolderBadgeProps): ReactNode {
  if (status === "bot" || holder === null) {
    return isBotShown ? (
      <Badge tone="neutral" icon={Bot}>
        Bot
      </Badge>
    ) : null;
  }
  const isMine = holder.id === meId;
  return (
    <Badge tone="primary" icon={UserRound}>
      {isMine ? "Taken over by you" : `Taken over by ${holder.name.split(" ")[0]}`}
    </Badge>
  );
}

export function NewNumberBadge(): ReactNode {
  return (
    <Badge tone="yellow" icon={UserRoundPlus}>
      New number · in Intake
    </Badge>
  );
}

type WindowCueProps = {
  replyWindow: WindowState;
  isTakenOverByMe: boolean;
};

// "Takeover closes in 5h" while the bot holds it; "Replies close in 5h"
// once you're replying; "Reply outside the bot" after the 24 hours.
export function WindowCue({
  replyWindow,
  isTakenOverByMe,
}: WindowCueProps): ReactNode {
  if (!replyWindow.isOpen) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-(--tl-danger)">
        <PhoneOff aria-hidden className="size-3.5" />
        Reply outside the bot
      </span>
    );
  }
  const isUrgent = replyWindow.msLeft < WINDOW_URGENT_MS;
  const verb = isTakenOverByMe ? "Replies close" : "Takeover closes";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[13px] tabular-nums",
        isUrgent
          ? "font-semibold text-(--tl-warning)"
          : "font-medium text-(--tl-muted)",
      )}
    >
      <Clock aria-hidden className="size-3.5" />
      {verb} in {formatDuration(replyWindow.msLeft)}
    </span>
  );
}

type GuardianAvatarProps = {
  guardian: GuardianRef | null;
  size?: "sm" | "md" | "lg";
};

export function GuardianAvatar({
  guardian,
  size = "md",
}: GuardianAvatarProps): ReactNode {
  if (guardian) return <Avatar name={guardian.name} size={size} />;
  const sizes = { sm: "size-8", md: "size-10", lg: "size-12" };
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-(--tl-surface-sunk) text-(--tl-muted)",
        sizes[size],
      )}
    >
      <UserRoundPlus className="size-5" />
    </span>
  );
}
