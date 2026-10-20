// The Needs attention card at the top of a flagged thread: the reason,
// what it means, the action that settles it, and Mark done. A
// Reactivation request has no Mark done: the API wants a decision
// (Restore or Decline) instead.
import type { ReactNode } from "react";
import {
  CalendarPlus,
  Check,
  CircleAlert,
  Link2,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/kit/components/button";
import { cn } from "@/components/kit/tokens";
import type { ConversationRead } from "@/pages/prototype/chats/types/api";
import { FLAG_EXPLANATION, FLAG_LABEL } from "@/pages/prototype/chats/lib/labels";
import { formatDayAndTime } from "@/pages/prototype/chats/lib/time";
import PrototypeNote from "@/pages/prototype/chats/components/prototype-note";

type AttentionCardProps = {
  conversation: ConversationRead;
  onMarkDone: () => void;
  onResolveReactivation: (isApproved: boolean) => void;
  onOtherArea: (action: string) => void;
  // The phone page pins a shorter card: reason and actions.
  isCompact?: boolean;
};

const BOT_PROBLEMS = ["stuck", "didnt_understand"];

export default function AttentionCard({
  conversation,
  onMarkDone,
  onResolveReactivation,
  onOtherArea,
  isCompact = false,
}: AttentionCardProps): ReactNode {
  const reason = conversation.flag_reason;
  if (reason === null) return null;
  const isProblem = BOT_PROBLEMS.includes(reason);
  const child = conversation.reactivation_request?.child ?? null;
  const isReactivation = reason === "reactivation_request";

  return (
    <section
      aria-label="Needs attention"
      className={cn(
        "rounded-[20px]",
        isCompact ? "px-3 py-2.5" : "p-4",
        isProblem
          ? "bg-(--tl-danger-tint) text-(--tl-danger)"
          : "bg-(--tl-yellow-tint) text-(--tl-yellow-ink)",
      )}
    >
      <div className="flex items-start gap-3">
        <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-6 font-bold">
            Needs attention: {FLAG_LABEL[reason]}
          </p>
          <p
            className={cn(
              "mt-0.5 text-[14px] leading-5 text-(--tl-ink-soft)",
              isCompact && "sr-only",
            )}
          >
            {isReactivation && child
              ? `${conversation.guardian?.name.split(" ")[0] ?? "The Guardian"} asked to restore ${child.name}, who is archived.`
              : FLAG_EXPLANATION[reason]}
          </p>
          {conversation.flagged_at && !isCompact && (
            <p className="mt-1 text-[12px] opacity-80">
              Flagged {formatDayAndTime(conversation.flagged_at)}
            </p>
          )}
        </div>
      </div>
      <div className={cn("flex flex-wrap gap-2", isCompact ? "mt-2" : "mt-3 pl-8")}>
        {isReactivation && child && (
          <>
            <Button
              variant="primary"
              icon={RotateCcw}
              onClick={() => onResolveReactivation(true)}
            >
              Restore {child.name.split(" ")[0]}
            </Button>
            <Button variant="outline" onClick={() => onResolveReactivation(false)}>
              Decline
            </Button>
            <PrototypeNote note="Does Decline tell the Guardian anything, or does the office reply by hand? And is Restore/Decline the right pair here? Open question." />
          </>
        )}
        {reason === "booking_request" && (
          <Button
            variant="soft"
            icon={CalendarPlus}
            onClick={() => onOtherArea("New booking")}
          >
            New booking
          </Button>
        )}
        {reason === "guardian_link_request" && (
          <Button
            variant="soft"
            icon={Link2}
            onClick={() => onOtherArea("Link guardian")}
          >
            Link guardian
          </Button>
        )}
        {!isReactivation && (
          <Button variant="outline" icon={Check} onClick={onMarkDone}>
            Mark done
          </Button>
        )}
      </div>
    </section>
  );
}
