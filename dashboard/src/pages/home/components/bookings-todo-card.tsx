// To do › Bookings in buildBookingTodo's order: Bookings to change,
// Children needing a Tutor, Bookings not marked, then Evaluations to book.
// A Booking opens its details, a Child needing a Tutor opens their
// family, and an Evaluation to book opens Home's own overlay.
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, Sparkles, UserRoundX } from "lucide-react";
import { BookingReasonBadge } from "@/components/kit/components/badges";
import TodoCard from "@/components/kit/components/todo-card";
import { formatDay } from "@/components/kit/format";
import { cn } from "@/components/kit/tokens";
import type { BookingTodoItem } from "@/lib/bookings/booking-todo";
import type { ChildSummary } from "@/lib/queries/children";
import TodoRow from "@/pages/home/components/todo-row";
import { TODO_DETAIL } from "@/pages/home/components/todo-row";
import type { HomeGroup, TodoList } from "@/pages/home/hooks/use-home-data";
import {
  formatBookingWhen,
  getWaitingLabel,
  ROWS_PER_CARD,
} from "@/pages/home/lib/home-labels";

const NEEDS_ATTENTION_PATH = "/bookings?needs_attention=1";
const CHIP =
  "flex size-11 shrink-0 items-center justify-center rounded-[14px]";

type BookingsTodoCardProps = {
  group: HomeGroup<TodoList<BookingTodoItem>>;
  isManager: boolean;
  now: Date;
  onOpenBooking: (bookingId: string) => void;
  onOpenEvaluation: (child: ChildSummary) => void;
};

export default function BookingsTodoCard({
  group,
  isManager,
  now,
  onOpenBooking,
  onOpenEvaluation,
}: BookingsTodoCardProps): ReactNode {
  const navigate = useNavigate();
  return (
    <TodoCard
      id="bookings"
      title="Bookings"
      icon={CalendarClock}
      tone="green"
      phase={group.phase}
      total={group.data?.total ?? 0}
      emptyHint={
        isManager
          ? "Every Child has an Evaluation booked and an Assigned Tutor."
          : "Every Booking is marked, and every Child has an Evaluation booked and an Assigned Tutor."
      }
      seeAllLabel="bookings that need attention"
      onSeeAll={() => navigate(NEEDS_ATTENTION_PATH)}
      onRetry={group.retry}
      isRetrying={group.isRetrying}
    >
      {group.data?.items.slice(0, ROWS_PER_CARD).map((item) => (
        <BookingTodoRow
          key={`${item.kind}-${item.kind === "booking" ? item.booking.id : item.child.id}`}
          item={item}
          now={now}
          onOpenBooking={onOpenBooking}
          onOpenEvaluation={onOpenEvaluation}
        />
      ))}
    </TodoCard>
  );
}

type BookingTodoRowProps = {
  item: BookingTodoItem;
  now: Date;
  onOpenBooking: (bookingId: string) => void;
  onOpenEvaluation: (child: ChildSummary) => void;
};

function BookingTodoRow({
  item,
  now,
  onOpenBooking,
  onOpenEvaluation,
}: BookingTodoRowProps): ReactNode {
  if (item.kind === "booking") {
    const { booking } = item;
    const reason = booking.sort_out_reasons[0] ?? "not_completed";
    return (
      <TodoRow
        action={{ onOpen: () => onOpenBooking(booking.id) }}
        title={booking.child.name}
        badge={<BookingReasonBadge reason={reason} />}
        leading={<DateChip date={booking.scheduled_date} />}
      >
        <span className={TODO_DETAIL}>
          {formatBookingWhen(booking)} · {booking.staff.name}
        </span>
      </TodoRow>
    );
  }

  const { child } = item;
  if (item.kind === "needs-tutor") {
    const subjects = (child.levels ?? []).map((level) => level.name);
    return (
      <TodoRow
        action={{ to: `/families/${child.id}?child=${child.id}` }}
        title={child.name}
        badge={<BookingReasonBadge reason="needs_tutor" />}
        leading={
          <span
            aria-hidden
            className={cn(CHIP, "bg-(--tl-warning-tint) text-(--tl-warning)")}
          >
            <UserRoundX className="size-[18px]" />
          </span>
        }
      >
        <span className={TODO_DETAIL}>
          {["No Assigned Tutors", subjects.join(", ")]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </TodoRow>
    );
  }

  const guardian = child.guardians[0]?.name;
  return (
    <TodoRow
      action={{ onOpen: () => onOpenEvaluation(child) }}
      title={child.name}
      badge={<BookingReasonBadge reason="evaluation_to_book" />}
      leading={
        <span
          aria-hidden
          className={cn(CHIP, "bg-(--tl-pink-tint) text-(--tl-pink-ink)")}
        >
          <Sparkles className="size-[18px]" />
        </span>
      }
    >
      <span className={TODO_DETAIL}>
        {[getWaitingLabel(child.created_at, now), guardian]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </TodoRow>
  );
}

type DateChipProps = { date: string };

// 12px month at the least (DESIGN §17 #9).
function DateChip({ date }: DateChipProps): ReactNode {
  return (
    <span
      aria-hidden
      className={cn(
        CHIP,
        "flex-col bg-(--tl-tint) text-(--tl-primary-ink) tabular-nums",
      )}
    >
      <span className="text-[12px] leading-3 font-semibold uppercase">
        {formatDay(date, { month: "short" })}
      </span>
      <span className="text-[16px] leading-5 font-bold">
        {formatDay(date, { day: "numeric" })}
      </span>
    </span>
  );
}
