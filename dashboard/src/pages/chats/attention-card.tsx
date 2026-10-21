// The Needs attention card pinned above a flagged thread: the reason,
// what it means, and the act that settles it. A Reactivation request is
// settled by a decision (Restore or Decline), never by Mark done.
import type { ReactNode } from "react";
import { Check, CircleAlert, Clock, RotateCcw } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import { cn } from "@/components/kit/tokens";
import {
  FLAG_REASON_LABEL,
  getFirstName,
  getFlagExplanation,
  isBotProblem,
} from "@/lib/chats/labels";
import { formatDayAndTime } from "@/lib/chats/time";
import type {
  ConversationDetail,
  FlagReason,
} from "@/lib/queries/conversations";
import { getActAttributes, useAttentionActs } from "@/pages/chats/use-attention-acts";

type AttentionCardProps = {
  conversation: ConversationDetail;
  // The phone card shows the reason and actions only.
  isCompact: boolean;
  // Arrived while the chat was open (stream or Undo): fades in.
  isLive?: boolean;
};

const BOT_TONE = "bg-(--tl-danger-tint) text-(--tl-danger)";
const WINDOW_TONE = "bg-(--tl-warning-tint) text-(--tl-warning)";
const HANDOFF_TONE = "bg-(--tl-yellow-tint) text-(--tl-yellow-ink)";

function getTone(reason: FlagReason): string {
  if (isBotProblem(reason)) return BOT_TONE;
  if (reason === "reply_window_closed") return WINDOW_TONE;
  return HANDOFF_TONE;
}

function getExplanation(conversation: ConversationDetail, reason: FlagReason) {
  const first = conversation.guardian
    ? getFirstName(conversation.guardian.name)
    : "the Guardian";
  const child = conversation.reactivation_request?.child ?? null;
  if (reason === "reactivation_request" && child) {
    return `${first} asked to restore ${child.name}, who is archived.`;
  }
  return getFlagExplanation(reason, first);
}

export default function AttentionCard({
  conversation,
  isCompact,
  isLive = false,
}: AttentionCardProps): ReactNode {
  const acts = useAttentionActs(conversation);
  const reason = conversation.flag_reason;
  if (reason === null) return null;

  const child = conversation.reactivation_request?.child ?? null;
  const isReactivation = reason === "reactivation_request";
  const Icon = reason === "reply_window_closed" ? Clock : CircleAlert;
  const isBusy = acts.pendingAct !== null;

  return (
    <section
      aria-label="Needs attention"
      data-slot="attention-card"
      data-compact={isCompact}
      className={cn(
        "rounded-[20px]",
        isCompact ? "px-3 py-2.5" : "p-4",
        getTone(reason),
        isLive && "kit-fade",
      )}
    >
      <div className="flex items-start gap-3">
        <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-6 font-bold">
            Needs attention: {FLAG_REASON_LABEL[reason]}
          </p>
          <p
            className={cn(
              "mt-0.5 text-[14px] leading-5 text-(--tl-ink-soft)",
              isCompact && "sr-only",
            )}
          >
            {getExplanation(conversation, reason)}
          </p>
          {conversation.flagged_at && !isCompact && (
            <p className="mt-1 text-[12px]">
              Flagged {formatDayAndTime(conversation.flagged_at)}
            </p>
          )}
        </div>
      </div>
      <div
        className={cn("flex flex-wrap gap-2", isCompact ? "mt-2" : "mt-3 pl-8")}
      >
        {isReactivation && child && (
          <>
            <Button
              variant="primary"
              icon={RotateCcw}
              {...getActAttributes(conversation.id, "restore")}
              isLoading={acts.pendingAct === "restore"}
              disabled={isBusy}
              onClick={() => void acts.restore()}
            >
              Restore {getFirstName(child.name)}
            </Button>
            <Button
              variant="outline"
              {...getActAttributes(conversation.id, "decline")}
              isLoading={acts.pendingAct === "decline"}
              disabled={isBusy}
              onClick={() => void acts.decline()}
            >
              Decline
            </Button>
          </>
        )}
        {!isReactivation && (
          <Button
            variant="outline"
            icon={Check}
            {...getActAttributes(conversation.id, "mark-done")}
            isLoading={acts.pendingAct === "mark-done"}
            disabled={isBusy}
            onClick={() => void acts.markDone()}
          >
            Mark done
          </Button>
        )}
      </div>
      {acts.alert && (
        <p
          role="alert"
          className={cn(
            "kit-fade mt-2 flex items-center gap-1.5 text-[13px] font-medium text-(--tl-danger)",
            !isCompact && "pl-8",
          )}
        >
          <CircleAlert aria-hidden className="size-4 shrink-0" />
          {acts.alert}
        </p>
      )}
    </section>
  );
}
