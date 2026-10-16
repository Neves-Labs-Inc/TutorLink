// Manager Home: their own teaching today, as the card rows Tutors see on
// My sessions (TutorLink#191). "Session" because it's their own.
import type { ReactNode } from "react";
import { CalendarCheck, MapPin } from "lucide-react";
import { KindBadge } from "@/components/kit/components/badges";
import { ListRow, TimeBlock } from "@/components/kit/components/list-row";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/kit/states/states";
import type { Phase } from "@/pages/prototype/home/hooks/use-home-data";
import {
  formatClock,
  getLocationLabel,
  getSubjectLabel,
  isHappeningNow,
  isPast,
  sortForToday,
} from "@/pages/prototype/home/lib/labels";
import type { BookingSummary } from "@/pages/prototype/home/types/api";

function getCaption(session: BookingSummary): string {
  let caption = `to ${formatClock(session.end_time)}`;
  if (isHappeningNow(session)) {
    caption = "Now";
  } else if (isPast(session)) {
    caption = "Done";
  }
  return caption;
}

type MySessionsTodayProps = {
  phase: Phase;
  sessions: BookingSummary[];
  onOpen: (session: BookingSummary) => void;
  onRetry: () => void;
};

export default function MySessionsToday({
  phase,
  sessions,
  onOpen,
  onRetry,
}: MySessionsTodayProps): ReactNode {
  let content: ReactNode = (
    <ul className="flex flex-col gap-3">
      {sortForToday(sessions).map((session) => (
        <li key={session.id}>
          <ListRow
            leading={
              <TimeBlock
                time={formatClock(session.start_time)}
                caption={getCaption(session)}
              />
            }
            title={session.child.name}
            subtitle={session.subject ? getSubjectLabel(session) : undefined}
            details={[{ icon: MapPin, text: getLocationLabel(session) }]}
            badges={
              session.kind === "evaluation" ? <KindBadge kind="Evaluation" /> : undefined
            }
            isMuted={isPast(session)}
            onOpen={() => onOpen(session)}
          />
        </li>
      ))}
    </ul>
  );
  if (phase === "loading") {
    content = <ListSkeleton rows={2} label="Loading your sessions" />;
  } else if (phase === "error") {
    content = (
      <ErrorState
        title="Couldn’t load your sessions"
        body="Check your connection and try again."
        onRetry={onRetry}
      />
    );
  } else if (sessions.length === 0) {
    content = (
      <EmptyState
        icon={CalendarCheck}
        title="No sessions today"
        body="Your own teaching shows here. The office’s whole day is on Bookings."
      />
    );
  }
  return content;
}
