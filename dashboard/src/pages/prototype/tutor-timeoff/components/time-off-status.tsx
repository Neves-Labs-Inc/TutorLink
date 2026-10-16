// Time off status as a badge: word + dot, never colour alone.
import type { ReactNode } from "react";
import { Hourglass } from "lucide-react";
import { Badge } from "@/components/kit/components/badges";
import type { Tone } from "@/components/kit/tokens";
import { TIME_OFF_STATUS_LABEL } from "@/pages/prototype/tutor-timeoff/lib/labels";
import type { ExceptionReadStatus } from "@/pages/prototype/tutor-timeoff/types/api";

const STATUS_TONE: Record<ExceptionReadStatus, Tone> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
  expired: "neutral",
};

type TimeOffStatusBadgeProps = { status: ExceptionReadStatus };

// The kit's TimeOffBadge has no Expired and takes display labels, so
// this local one takes the wire status.
export function TimeOffStatusBadge({ status }: TimeOffStatusBadgeProps): ReactNode {
  const isExpired = status === "expired";
  return (
    <Badge tone={STATUS_TONE[status]} hasDot={!isExpired} icon={isExpired ? Hourglass : undefined}>
      {TIME_OFF_STATUS_LABEL[status]}
    </Badge>
  );
}
