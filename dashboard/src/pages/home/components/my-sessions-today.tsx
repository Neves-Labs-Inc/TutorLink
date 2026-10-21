// Managers' My sessions today: their own Bookings today but cancelled
// ones, next first, the ones already over muted. Each opens its details.
import type { ReactNode } from "react";
import { CalendarCheck, MapPin } from "lucide-react";
import { KindBadge } from "@/components/kit/components/badges";
import { ListRow, TimeBlock } from "@/components/kit/components/list-row";
import { formatClock } from "@/components/kit/format";
import {
  EmptyState,
  InlineError,
  ListSkeleton,
} from "@/components/kit/states/states";
import type { BookingSummary } from "@/lib/queries/bookings";
import type { HomeGroup } from "@/pages/home/hooks/use-home-data";
import {
  getLocationLabel,
  getSubjectLabel,
  getTodayTiming,
} from "@/pages/home/lib/home-labels";
import type { TodayTiming } from "@/pages/home/lib/home-labels";

function getCaption(booking: BookingSummary, timing: TodayTiming): string {
  let caption = `to ${formatClock(booking.end_time)}`;
  if (timing === "now") {
    caption = "Now";
  } else if (timing === "past") {
    caption = "Done";
  }
  return caption;
}

type MySessionsTodayProps = {
  group: HomeGroup<BookingSummary[]>;
  now: Date;
  onOpen: (bookingId: string) => void;
};

export default function MySessionsToday({
  group,
  now,
  onOpen,
}: MySessionsTodayProps): ReactNode {
  if (group.phase === "loading") {
    return <ListSkeleton rows={2} label="Loading your sessions" />;
  }
  if (group.phase === "error" || !group.data) {
    return (
      <InlineError
        message="Couldn’t load your sessions. Check your connection and try again."
        onRetry={group.retry}
        isRetrying={group.isRetrying}
      />
    );
  }
  if (group.data.length === 0) {
    return (
      <EmptyState
        icon={CalendarCheck}
        title="No sessions today"
        body="Nothing is booked for you today."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {group.data.map((booking) => {
        const timing = getTodayTiming(booking, now);
        const isEvaluation = booking.kind === "evaluation";
        return (
          <li key={booking.id}>
            <ListRow
              leading={
                <TimeBlock
                  time={formatClock(booking.start_time)}
                  caption={getCaption(booking, timing)}
                  tone={isEvaluation ? "pink" : "primary"}
                />
              }
              title={booking.child.name}
              subtitle={getSubjectLabel(booking)}
              details={[{ icon: MapPin, text: getLocationLabel(booking) }]}
              badges={isEvaluation && <KindBadge kind="evaluation" />}
              isMuted={timing === "past"}
              onOpen={() => onOpen(booking.id)}
            />
          </li>
        );
      })}
    </ul>
  );
}
