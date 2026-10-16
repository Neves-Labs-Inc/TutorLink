// A Session as its Tutor (or a Manager, for their own) sees it, phone
// first: when, Subject level, Child notes, where with directions and a
// maps link, and the office's number. Tutors reach Guardians through
// the office, so Guardians are named but not contactable (#183).
import { useState } from "react";
import type { ReactNode } from "react";
import {
  BookOpen,
  Building2,
  CalendarDays,
  Check,
  MapPin,
  Navigation,
  Phone,
  Signpost,
  Users,
} from "lucide-react";
import {
  Badge,
  BookingStatusBadge,
  KindBadge,
} from "@/pages/prototype/shell-kit/kit/components/badges";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import { DetailRow, NotesCard } from "@/pages/prototype/shell-kit/kit/components/detail";
import { DetailOverlay } from "@/pages/prototype/shell-kit/kit/overlays/detail-overlay";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";
import LinkButton from "@/pages/prototype/tutor-timeoff/components/link-button";
import OpenQuestion from "@/pages/prototype/tutor-timeoff/components/open-question";
import {
  formatClock,
  formatLevel,
  formatLongDate,
  formatPhone,
  getFirstName,
  getMapsUrl,
} from "@/pages/prototype/tutor-timeoff/lib/labels";
import { hasStarted, isLive, isUnmarked } from "@/pages/prototype/tutor-timeoff/lib/rules";
import type { BookingDetail, MeRead } from "@/pages/prototype/tutor-timeoff/types/api";
import type { Result } from "@/pages/prototype/tutor-timeoff/hooks/use-area-store";

const MINUTES_PER_HOUR = 60;

function getMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * MINUTES_PER_HOUR + minutes;
}

type SessionDetailProps = {
  session: BookingDetail | null;
  me: MeRead;
  backLabel: string;
  onClose: () => void;
  onMarkCompleted: (id: string) => Promise<Result<BookingDetail>>;
};

export default function SessionDetail({
  session,
  me,
  backLabel,
  onClose,
  onMarkCompleted,
}: SessionDetailProps): ReactNode {
  const [isMarking, setIsMarking] = useState(false);
  const { showToast } = useToast();
  if (!session) return null;

  const isOffice = session.location === "in_office" || session.home === null;
  // A Manager viewing their own Session is the office: no "call the
  // office", and marking is their question, not the Tutor one.
  const isOfficeViewer = me.role !== "tutor";
  const markQuestion = isOfficeViewer
    ? "Me is gone. Who marks a Manager’s own unmarked sessions, and where: here on their profile, in To do › Bookings, or only from Bookings › Mine?"
    : "Tutors may mark their own Session Completed (the API allows it once it has started). Offer it here, or leave marking to the office?";
  const canMark = isLive(session) && hasStarted(session);
  const duration = getMinutes(session.end_time) - getMinutes(session.start_time);

  async function handleMark(): Promise<void> {
    if (!session) return;
    setIsMarking(true);
    const result = await onMarkCompleted(session.id);
    setIsMarking(false);
    showToast(
      result.error
        ? { tone: "error", message: result.error }
        : { tone: "success", message: `Session with ${getFirstName(session.child.name)} marked Completed.` },
    );
  }

  const footer = (
    <>
      {canMark && (
        <span className="flex items-center gap-2 pr-2 @md:flex-1">
          <Button
            variant="primary"
            icon={Check}
            isFullWidth
            isLoading={isMarking}
            onClick={handleMark}
          >
            Mark completed
          </Button>
          <OpenQuestion question={markQuestion} />
        </span>
      )}
      {me.office_phone && !isOfficeViewer && (
        <LinkButton
          icon={Phone}
          href={`tel:${me.office_phone}`}
          isFullWidth
          className="@md:flex-1"
        >
          Call the office
        </LinkButton>
      )}
    </>
  );

  return (
    <DetailOverlay
      isOpen
      onClose={onClose}
      title={`Session with ${session.child.name}`}
      backLabel={backLabel}
      phoneMode="page"
      header={
        <div className="flex flex-wrap gap-2">
          <KindBadge kind={session.kind} />
          {isUnmarked(session) ? (
            <Badge tone="warning" hasDot>
              Not marked
            </Badge>
          ) : (
            <BookingStatusBadge status={session.status} />
          )}
        </div>
      }
      footer={canMark || (me.office_phone && !isOfficeViewer) ? footer : undefined}
    >
      <h2 className="kit-display text-[28px] leading-9 font-light">{session.child.name}</h2>
      <div className="mt-6 flex flex-col gap-5">
        <DetailRow icon={CalendarDays} label="When">
          <p className="font-semibold">{formatLongDate(session.scheduled_date)}</p>
          <p className="text-(--tl-ink-soft) tabular-nums">
            {formatClock(session.start_time)} – {formatClock(session.end_time)} ·{" "}
            {duration} min
          </p>
        </DetailRow>
        <DetailRow icon={BookOpen} label={session.kind === "evaluation" ? "What" : "Subject level"}>
          {session.kind === "evaluation" ? (
            <>
              <p className="font-semibold">Evaluation session</p>
              <p className="text-(--tl-ink-soft)">You’ll assess their Subject levels.</p>
            </>
          ) : (
            <p className="font-semibold">
              {session.subject?.name}
              {session.subject_level !== null && ` · ${formatLevel(session.subject_level)}`}
            </p>
          )}
        </DetailRow>
        {session.child.notes ? (
          <NotesCard>{session.child.notes}</NotesCard>
        ) : (
          <p className="rounded-[18px] bg-(--tl-surface-sunk) px-4 py-3 text-[14px] text-(--tl-muted)">
            No Child notes from the office.
          </p>
        )}
        <DetailRow icon={isOffice ? Building2 : MapPin} label="Location">
          {isOffice || !session.home ? (
            <p className="font-semibold">In office</p>
          ) : (
            <>
              {session.home.label && (
                <p className="text-[13px] font-semibold text-(--tl-muted)">
                  {session.home.label} home
                </p>
              )}
              <p className="font-semibold">{session.home.address}</p>
            </>
          )}
        </DetailRow>
        {!isOffice && session.home && (
          <div className="flex flex-col gap-3 rounded-[18px] bg-(--tl-surface-sunk) p-4">
            <p className="flex items-start gap-2 text-[14px] leading-6">
              <Signpost aria-hidden className="mt-1 size-4 shrink-0 text-(--tl-muted)" />
              {session.home.directions ?? (
                <span className="text-(--tl-muted)">No directions saved for this Home.</span>
              )}
            </p>
            <LinkButton
              icon={Navigation}
              variant="soft"
              href={getMapsUrl(session.home.address)}
              target="_blank"
              rel="noreferrer"
              isFullWidth
            >
              Get directions
            </LinkButton>
          </div>
        )}
        <DetailRow icon={Users} label={session.guardians.length === 1 ? "Guardian" : "Guardians"}>
          <p className="font-semibold">
            {session.guardians.map((guardian) => guardian.name).join(", ")}
          </p>
          <p className="text-[14px] text-(--tl-ink-soft)">
            {session.booked_by_guardian
              ? `Booked by ${getFirstName(session.booked_by_guardian.name)} through the bot. `
              : "Booked by the office. "}
            {!isOfficeViewer &&
              `To reach them, call the office${me.office_phone ? ` at ${formatPhone(me.office_phone)}` : ""}.`}
          </p>
        </DetailRow>
      </div>
    </DetailOverlay>
  );
}
