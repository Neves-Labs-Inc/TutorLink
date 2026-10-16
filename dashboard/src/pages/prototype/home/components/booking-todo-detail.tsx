// What a To do › Bookings row opens: a slide-over on desktop, a page
// pushed in from the right on phone. A callout says why it is in To do;
// the footer holds that reason's actions (Completed / Didn't happen,
// Change / Keep, Change / Cancel, or Book evaluation). Forms are
// placeholders owned by the Bookings prototype.
import type { ReactNode } from "react";
import {
  BookOpen,
  CalendarDays,
  CalendarX2,
  Check,
  CircleSlash,
  Clock,
  GraduationCap,
  Home,
  MapPin,
  Pencil,
  Sparkles,
  UserRound,
  UserRoundX,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge, KindBadge } from "@/pages/prototype/shell-kit/kit/components/badges";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import { DetailRow } from "@/pages/prototype/shell-kit/kit/components/detail";
import { DetailOverlay } from "@/pages/prototype/shell-kit/kit/overlays/detail-overlay";
import { CARD_TITLE, cn } from "@/pages/prototype/shell-kit/kit/tokens";
import type { TodoActions } from "@/pages/prototype/home/hooks/use-todo-actions";
import {
  formatClock,
  formatDate,
  formatWaiting,
  getSubjectLabel,
  SORT_OUT_LABEL,
} from "@/pages/prototype/home/lib/labels";
import type { BookingTodo } from "@/pages/prototype/home/lib/labels";
import type {
  BookingSummary,
  ChildSummary,
  SortOutReason,
} from "@/pages/prototype/home/types/api";

type ReasonCopy = { icon: LucideIcon; tone: string; body: (booking: BookingSummary) => string };

const REASON_COPY: Record<SortOutReason, ReasonCopy> = {
  not_completed: {
    icon: Clock,
    tone: "bg-(--tl-neutral-tint) text-(--tl-neutral)",
    body: () =>
      "Its date has passed and nobody has marked it. Say whether it happened.",
  },
  time_off_clash: {
    icon: CalendarX2,
    tone: "bg-(--tl-warning-tint) text-(--tl-warning)",
    body: (booking) =>
      `${booking.staff.name} has approved time off then. Change the booking, or keep it if they’ll still teach it.`,
  },
  archived_staff: {
    icon: UserRoundX,
    tone: "bg-(--tl-danger-tint) text-(--tl-danger)",
    body: (booking) =>
      `${booking.staff.name} is archived. Give the booking to someone else, or cancel it.`,
  },
};

type BookingTodoDetailProps = {
  item: BookingTodo | null;
  canKeepClash: boolean;
  actions: TodoActions;
  onClose: () => void;
};

export default function BookingTodoDetail({
  item,
  canKeepClash,
  actions,
  onClose,
}: BookingTodoDetailProps): ReactNode {
  const title = item?.kind === "evaluation" ? item.child.name : item?.booking.child.name;
  return (
    <DetailOverlay
      isOpen={item !== null}
      onClose={onClose}
      title={title ?? "Booking"}
      backLabel="Home"
      phoneMode="page"
      header={
        item && (
          <div className="flex flex-col gap-2">
            {item.kind === "evaluation" ? (
              <Badge tone="pink" icon={Sparkles}>
                Evaluation to book
              </Badge>
            ) : (
              <KindBadge kind={item.booking.kind === "evaluation" ? "Evaluation" : "Tutoring"} />
            )}
            <h2 className="kit-display text-[22px] leading-[30px] font-bold">{title}</h2>
          </div>
        )
      }
      footer={
        item &&
        (item.kind === "evaluation" ? (
          <Button
            variant="primary"
            icon={CalendarDays}
            onClick={() => actions.openBookEvaluation(item.child)}
          >
            Book evaluation
          </Button>
        ) : (
          <BookingActions
            booking={item.booking}
            canKeepClash={canKeepClash}
            actions={actions}
            onClose={onClose}
          />
        ))
      }
    >
      {item?.kind === "booking" && <BookingBody booking={item.booking} />}
      {item?.kind === "evaluation" && <EvaluationBody child={item.child} />}
    </DetailOverlay>
  );
}

type BookingBodyProps = { booking: BookingSummary };

function BookingBody({ booking }: BookingBodyProps): ReactNode {
  return (
    <div className="flex flex-col gap-5 pt-3">
      {booking.sort_out_reasons.map((reason) => {
        const copy = REASON_COPY[reason];
        const Icon = copy.icon;
        return (
          <section key={reason} className={cn("rounded-[18px] p-4", copy.tone)}>
            <h3 className={cn(CARD_TITLE, "flex items-center gap-2")}>
              <Icon aria-hidden className="size-[18px]" />
              {SORT_OUT_LABEL[reason]}
            </h3>
            <p className="mt-1 text-[14px] leading-5">{copy.body(booking)}</p>
          </section>
        );
      })}
      <DetailRow icon={CalendarDays} label="When">
        {formatDate(booking.scheduled_date, { weekday: "long", month: "long", day: "numeric" })}
        , {formatClock(booking.start_time)} – {formatClock(booking.end_time)}
      </DetailRow>
      <DetailRow icon={BookOpen} label="Subject">
        {booking.kind === "evaluation" || booking.subject ? getSubjectLabel(booking) : "—"}
      </DetailRow>
      <DetailRow icon={UserRound} label="Staff">
        {booking.staff.name}
      </DetailRow>
      <DetailRow icon={MapPin} label="Location">
        {booking.home?.address ?? "In office"}
      </DetailRow>
    </div>
  );
}

type BookingActionsProps = {
  booking: BookingSummary;
  canKeepClash: boolean;
  actions: TodoActions;
  onClose: () => void;
};

// The first reason picks the actions; a Booking with several shows
// every callout but one set of buttons (open question).
function BookingActions({
  booking,
  canKeepClash,
  actions,
  onClose,
}: BookingActionsProps): ReactNode {
  const reason = booking.sort_out_reasons[0] ?? "not_completed";
  const isBusy = actions.busyId === booking.id;
  let buttons: ReactNode;
  if (reason === "not_completed") {
    buttons = (
      <>
        <Button
          variant="primary"
          icon={Check}
          isLoading={isBusy}
          onClick={() => actions.resolveBooking(booking, "completed", onClose)}
        >
          Completed
        </Button>
        <Button
          icon={CircleSlash}
          disabled={isBusy}
          onClick={() => actions.resolveBooking(booking, "didnt-happen", onClose)}
        >
          Didn’t happen
        </Button>
      </>
    );
  } else if (reason === "time_off_clash") {
    buttons = (
      <>
        <Button variant="primary" icon={Pencil} onClick={() => actions.openChangeBooking(booking)}>
          Change booking
        </Button>
        {canKeepClash && (
          <Button
            icon={Check}
            isLoading={isBusy}
            onClick={() => actions.resolveBooking(booking, "kept", onClose)}
          >
            Keep booking
          </Button>
        )}
      </>
    );
  } else {
    buttons = (
      <>
        <Button variant="primary" icon={Pencil} onClick={() => actions.openChangeBooking(booking)}>
          Change booking
        </Button>
        <Button
          variant="danger-outline"
          icon={X}
          isLoading={isBusy}
          onClick={() => actions.resolveBooking(booking, "cancelled", onClose)}
        >
          Cancel booking
        </Button>
      </>
    );
  }
  return buttons;
}

type EvaluationBodyProps = { child: ChildSummary };

function EvaluationBody({ child }: EvaluationBodyProps): ReactNode {
  const guardians = child.guardians.map((guardian) => guardian.name).join(", ");
  const homes = child.homes.filter((home) => !home.archived);
  return (
    <div className="flex flex-col gap-5 pt-3">
      <section className="rounded-[18px] bg-(--tl-pink-tint) p-4 text-(--tl-pink-ink)">
        <h3 className={cn(CARD_TITLE, "flex items-center gap-2")}>
          <Sparkles aria-hidden className="size-[18px]" />
          {formatWaiting(child)}
        </h3>
        <p className="mt-1 text-[14px] leading-5">
          Not Evaluated yet and no Evaluation booked. Book one with an Admin or
          Manager so the bot can start offering sessions.
        </p>
      </section>
      <DetailRow icon={Users} label="Guardians">
        {guardians || <span className="text-(--tl-muted)">None linked</span>}
      </DetailRow>
      <DetailRow icon={Home} label="Can be booked at">
        {homes.length > 0 ? (
          homes.map((home) => <span key={home.id} className="block">{home.address}</span>)
        ) : (
          <span className="text-(--tl-muted)">No home yet: In office only</span>
        )}
      </DetailRow>
      <DetailRow icon={GraduationCap} label="School">
        {child.school_name}
        {child.grade_level !== null && ` · Grade ${child.grade_level}`}
      </DetailRow>
    </div>
  );
}
