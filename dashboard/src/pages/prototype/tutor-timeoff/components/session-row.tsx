// One Session as a card row (Tutor-facing lists keep card rows, #191).
// The whole row opens the details; it carries no actions.
import type { ReactNode } from "react";
import { Building2, MapPin } from "lucide-react";
import {
  Badge,
  BookingStatusBadge,
  KindBadge,
} from "@/components/kit/components/badges";
import { formatDay } from "@/components/kit/format";
import { ListRow, TimeBlock } from "@/components/kit/components/list-row";
import {
  formatClock,
  getPlaceLine,
  getSubjectLine,
} from "@/pages/prototype/tutor-timeoff/lib/labels";
import {
  hasFinished,
  hasStarted,
  isLive,
  isUnmarked,
} from "@/pages/prototype/tutor-timeoff/lib/rules";
import type { BookingSummary } from "@/pages/prototype/tutor-timeoff/types/api";

function getCaption(session: BookingSummary): string {
  let caption = `to ${formatClock(session.end_time, true)}`;
  if (hasStarted(session) && !hasFinished(session) && isLive(session)) {
    caption = "Now";
  }
  return caption;
}

type SessionRowProps = {
  session: BookingSummary;
  // Outside a day-grouped list the row names its own day.
  isDayShown?: boolean;
  onOpen: (session: BookingSummary) => void;
};

export default function SessionRow({
  session,
  isDayShown = false,
  onOpen,
}: SessionRowProps): ReactNode {
  const isOffice = session.location === "in_office";
  const isCancelled = session.status === "cancelled";
  const badgeList = [
    session.kind === "evaluation" && <KindBadge key="kind" kind="evaluation" />,
    isUnmarked(session) && (
      <Badge key="unmarked" tone="warning" hasDot>
        Not marked
      </Badge>
    ),
    (isCancelled || session.status === "completed") && (
      <BookingStatusBadge key="status" status={session.status} />
    ),
  ].filter(Boolean);
  const badges = badgeList.length > 0 ? badgeList : undefined;
  return (
    <ListRow
      leading={
        <TimeBlock
          time={formatClock(session.start_time)}
          caption={
            isDayShown
              ? formatDay(session.scheduled_date, { month: "short", day: "numeric" })
              : getCaption(session)
          }
        />
      }
      title={session.child.name}
      subtitle={
        isDayShown
          ? `${formatDay(session.scheduled_date, { weekday: "long" })} · ${getSubjectLine(session)}`
          : getSubjectLine(session)
      }
      details={[{ icon: isOffice ? Building2 : MapPin, text: getPlaceLine(session) }]}
      badges={badges}
      isMuted={isCancelled || hasFinished(session)}
      isStruck={isCancelled}
      onOpen={() => onOpen(session)}
    />
  );
}
