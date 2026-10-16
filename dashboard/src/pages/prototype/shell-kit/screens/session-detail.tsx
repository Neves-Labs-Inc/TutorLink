// A Session as a Tutor sees it: Subject level, Child notes, Location
// with directions, and the office as the way to reach the Guardian.
import type { ReactNode } from "react";
import {
  BookOpen,
  Building2,
  CalendarDays,
  MapPin,
  MessageCircle,
  Navigation,
} from "lucide-react";
import {
  formatDay,
  formatTimeRange,
  getDayKey,
} from "@/pages/prototype/shell-kit/kit/format";
import type { Booking } from "@/pages/prototype/shell-kit/kit/mock-data";
import {
  BookingStatusBadge,
  KindBadge,
} from "@/pages/prototype/shell-kit/kit/components/badges";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import { DetailRow, NotesCard } from "@/pages/prototype/shell-kit/kit/components/detail";
import { DetailOverlay } from "@/pages/prototype/shell-kit/kit/overlays/detail-overlay";
import type { PhoneDetailMode } from "@/pages/prototype/shell-kit/kit/overlays/detail-overlay";

type SessionDetailProps = {
  session: Booking | null;
  onClose: () => void;
  phoneMode: PhoneDetailMode;
};

export default function SessionDetail({
  session,
  onClose,
  phoneMode,
}: SessionDetailProps): ReactNode {
  if (!session) return null;
  const isOffice = session.location === "In office";
  return (
    <DetailOverlay
      isOpen
      onClose={onClose}
      title={`Session: ${session.child}`}
      backLabel="My sessions"
      phoneMode={phoneMode}
      header={
        <div className="flex flex-wrap gap-2">
          <KindBadge kind={session.kind} />
          <BookingStatusBadge status={session.status} />
        </div>
      }
      footer={
        <Button variant="primary" icon={MessageCircle} isFullWidth>
          Message the office
        </Button>
      }
    >
      <h2 className="kit-display text-[28px] leading-9 font-light">
        {session.child}
      </h2>
      <div className="mt-6 flex flex-col gap-5">
        <DetailRow icon={CalendarDays} label="When">
          <p className="font-semibold">
            {formatDay(getDayKey(session.start), {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
          <p className="text-(--tl-ink-soft) tabular-nums">
            {formatTimeRange(session)}
          </p>
        </DetailRow>
        <DetailRow icon={BookOpen} label="Subject level">
          <p className="font-semibold">
            {session.subject} · {session.level}
          </p>
        </DetailRow>
        {session.childNotes && <NotesCard>{session.childNotes}</NotesCard>}
        <DetailRow icon={isOffice ? Building2 : MapPin} label="Location">
          <p className="font-semibold">{session.location}</p>
          {session.directions && (
            <p className="text-(--tl-ink-soft)">{session.directions}</p>
          )}
        </DetailRow>
        {!isOffice && (
          <Button icon={Navigation} isFullWidth>
            Get directions
          </Button>
        )}
      </div>
    </DetailOverlay>
  );
}
