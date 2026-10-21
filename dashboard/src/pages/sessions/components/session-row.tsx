// One Session as a card row. The whole row opens the details; it carries
// no actions. One status badge at most: Not marked, or the final status.
import type { ReactNode } from "react";
import { Building2, MapPin } from "lucide-react";
import { Badge, BookingStatusBadge, KindBadge } from "@/components/kit/components/badges";
import { ListRow, TimeBlock } from "@/components/kit/components/list-row";
import { formatClock } from "@/components/kit/format";
import type { BookingStatus, BookingSummary } from "@/lib/queries/bookings";
import {
  getPlaceLine,
  getSubjectLine,
  getTimeCaption,
  isInOffice,
} from "@/pages/sessions/lib/session-labels";
import { hasEnded, isNotMarked } from "@/pages/sessions/lib/session-rules";

const FINAL_STATUSES: readonly BookingStatus[] = ["cancelled", "completed", "didnt_happen"];

type SessionRowProps = {
  session: BookingSummary;
  now: Date;
  onOpen: () => void;
};

function getStatusBadge(session: BookingSummary, now: Date): ReactNode {
  let badge: ReactNode = null;
  if (isNotMarked(session, now)) {
    badge = (
      <Badge tone="warning" hasDot>
        Not marked
      </Badge>
    );
  } else if (FINAL_STATUSES.includes(session.status)) {
    badge = <BookingStatusBadge status={session.status} />;
  }
  return badge;
}

export function SessionRow({ session, now, onOpen }: SessionRowProps): ReactNode {
  const isCancelled = session.status === "cancelled";
  const statusBadge = getStatusBadge(session, now);
  const hasBadges = session.kind === "evaluation" || statusBadge !== null;
  return (
    <ListRow
      leading={
        <TimeBlock
          time={formatClock(session.start_time)}
          caption={getTimeCaption(session, now)}
          tone={session.kind === "evaluation" ? "pink" : "primary"}
        />
      }
      title={session.child.name}
      subtitle={getSubjectLine(session)}
      details={[
        { icon: isInOffice(session) ? Building2 : MapPin, text: getPlaceLine(session) },
      ]}
      badges={
        hasBadges ? (
          <>
            {session.kind === "evaluation" && <KindBadge kind="evaluation" />}
            {statusBadge}
          </>
        ) : undefined
      }
      isMuted={isCancelled || hasEnded(session, now)}
      isStruck={isCancelled}
      onOpen={onOpen}
    />
  );
}
