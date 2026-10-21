// The status in one sentence, in the status's tone. Focus lands here
// after an act removes the button that had it.
import type { ReactNode, Ref } from "react";
import { cn, TONE_CLASSES } from "@/components/kit/tokens";
import type { Tone } from "@/components/kit/tokens";
import type { ExceptionRead, TimeOffStatus } from "@/lib/queries/time-off";
import { getStatusSentence } from "@/pages/time-off/lib/time-off-copy";

const WELL_TONE: Record<TimeOffStatus, Tone> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
  expired: "neutral",
};

type TimeOffStatusWellProps = {
  item: ExceptionRead;
  viewerId: string;
  ref?: Ref<HTMLParagraphElement>;
};

export default function TimeOffStatusWell({
  item,
  viewerId,
  ref,
}: TimeOffStatusWellProps): ReactNode {
  return (
    <p
      ref={ref}
      tabIndex={-1}
      data-tone={WELL_TONE[item.status]}
      className={cn(
        "mt-4 rounded-[16px] px-4 py-3 text-[15px] leading-6",
        TONE_CLASSES[WELL_TONE[item.status]],
      )}
    >
      {getStatusSentence(item, viewerId)}
    </p>
  );
}
