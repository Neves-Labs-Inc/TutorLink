// Booking details' body: the reason callouts, the kept note, every fact
// about the Booking, and the restore warnings. User text renders as text.
import type { ReactNode } from "react";
import {
  BookOpen,
  CalendarCheck,
  CalendarDays,
  History,
  MessageCircle,
  Users,
} from "lucide-react";
import { ArchivedBadge, Avatar } from "@/components/kit/components/badges";
import { TextLink } from "@/components/kit/components/button";
import { DetailRow, NotesCard } from "@/components/kit/components/detail";
import { formatClock, formatDay } from "@/components/kit/format";
import BookingLocationRow from "@/components/booking-details/booking-location-row";
import BookingReasonCallouts from "@/components/booking-details/booking-reason-callouts";
import RestoreWarnings from "@/components/booking-details/restore-warnings";
import {
  formatShortDate,
  formatShortDateTime,
  getDurationMinutes,
  getFirstName,
  ROLE_WORDS,
} from "@/lib/bookings/booking-details";
import { gradeName } from "@/lib/grades/grades";
import type { BookingDetail, BookingWarning } from "@/lib/queries/bookings";

// An empty optional field (§12.4).
const MISSING = "—";

type BookingDetailsBodyProps = {
  booking: BookingDetail;
  canKeep: boolean;
  restoreWarnings: BookingWarning[] | null;
  isBusy: boolean;
  onStopKeeping: () => void;
  onOpenChat: (conversationId: string) => void;
};

export default function BookingDetailsBody({
  booking,
  canKeep,
  restoreWarnings,
  isBusy,
  onStopKeeping,
  onOpenChat,
}: BookingDetailsBodyProps): ReactNode {
  const isKept =
    booking.clash_acknowledged_at !== null &&
    booking.clashing_time_off.length > 0;
  const level =
    booking.subject_level === null ? MISSING : gradeName(booking.subject_level);
  return (
    <div className="flex flex-col gap-4">
      <BookingReasonCallouts booking={booking} canKeep={canKeep} />
      {isKept && booking.clash_acknowledged_at && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[16px] bg-(--tl-neutral-tint) px-4 py-3 text-[14px] leading-5 text-(--tl-neutral)">
          <CalendarCheck aria-hidden className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            Kept over {getFirstName(booking.staff.name)}’s Time off by{" "}
            {booking.clash_acknowledged_by?.name ?? "the office"},{" "}
            {formatShortDate(booking.clash_acknowledged_at)}
          </span>
          {canKeep && (
            <TextLink onClick={onStopKeeping} disabled={isBusy}>
              Stop keeping
            </TextLink>
          )}
        </div>
      )}
      <DetailRow icon={CalendarDays} label="When">
        <p className="font-semibold">
          {formatDay(booking.scheduled_date, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </p>
        <p className="text-(--tl-ink-soft) tabular-nums">
          {formatClock(booking.start_time)} – {formatClock(booking.end_time)} ·{" "}
          {getDurationMinutes(booking)} min
        </p>
      </DetailRow>
      <DetailRow icon={Users} label="Staff">
        <span className="flex flex-wrap items-center gap-2">
          <Avatar name={booking.staff.name} size="sm" />
          <span className="font-semibold">{booking.staff.name}</span>
          <span className="text-(--tl-muted)">
            · {ROLE_WORDS[booking.staff.role]}
          </span>
          {booking.sort_out_reasons.includes("archived_staff") && (
            <ArchivedBadge />
          )}
        </span>
      </DetailRow>
      <BookingLocationRow booking={booking} />
      <DetailRow
        icon={MessageCircle}
        label={booking.guardians.length > 1 ? "Guardians" : "Guardian"}
      >
        {booking.guardians.length === 0 && <p>{MISSING}</p>}
        <ul className="flex flex-col gap-1">
          {booking.guardians.map((guardian) => (
            <li
              key={guardian.id}
              className="flex flex-wrap items-center gap-x-3"
            >
              <span className="font-semibold">{guardian.name}</span>
              {guardian.conversation_id ? (
                <TextLink
                  onClick={() =>
                    guardian.conversation_id &&
                    onOpenChat(guardian.conversation_id)
                  }
                >
                  Open chat
                </TextLink>
              ) : (
                <span className="text-[14px] text-(--tl-muted)">
                  No chat yet
                </span>
              )}
            </li>
          ))}
        </ul>
      </DetailRow>
      <DetailRow icon={History} label="Booked">
        <p>
          {booking.booked_by_guardian
            ? `By ${booking.booked_by_guardian.name}, through the bot`
            : "By the office"}
          {` · ${formatShortDateTime(booking.created_at)}`}
        </p>
      </DetailRow>
      {booking.kind === "regular" && (
        <DetailRow icon={BookOpen} label="Subject level">
          <p>
            {booking.subject ? `${booking.subject.name}: ${level}` : MISSING}
          </p>
        </DetailRow>
      )}
      <NotesCard title="Booking notes">
        <p className="whitespace-pre-wrap">{booking.notes || MISSING}</p>
      </NotesCard>
      <NotesCard title="Notes for tutors">
        <p className="whitespace-pre-wrap">{booking.child.notes || MISSING}</p>
      </NotesCard>
      {restoreWarnings && <RestoreWarnings warnings={restoreWarnings} />}
    </div>
  );
}
