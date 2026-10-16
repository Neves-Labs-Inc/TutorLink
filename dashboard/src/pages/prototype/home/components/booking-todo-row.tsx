// One row of To do › Bookings. The whole row opens the details, where
// every action lives; there are no buttons on the row (Franklin,
// 2026-10-15, same rule as Time off).
import type { ReactNode } from "react";
import { ChevronRight, Sparkles, UserRoundX } from "lucide-react";
import { Badge } from "@/components/kit/components/badges";
import type { Tone } from "@/components/kit/tokens";
import { cn } from "@/components/kit/tokens";
import {
  formatClock,
  formatDate,
  formatLevels,
  formatWaiting,
  SORT_OUT_LABEL,
} from "@/pages/prototype/home/lib/labels";
import type { BookingTodo } from "@/pages/prototype/home/lib/labels";
import type { SortOutReason } from "@/pages/prototype/home/types/api";

const REASON_TONE: Record<SortOutReason, Tone> = {
  not_completed: "neutral",
  time_off_clash: "warning",
  archived_staff: "danger",
};

type RowCopy = { title: string; badge: ReactNode; detail: string };

function getCopy(item: BookingTodo): RowCopy {
  let copy: RowCopy;
  if (item.kind === "needs-tutor") {
    copy = {
      title: item.child.name,
      badge: (
        <Badge tone="warning" icon={UserRoundX}>
          Needs a Tutor
        </Badge>
      ),
      detail: `No Assigned Tutors · ${formatLevels(item.child)}`,
    };
  } else if (item.kind === "evaluation") {
    const guardian = item.child.guardians[0]?.name ?? "No Guardian";
    copy = {
      title: item.child.name,
      badge: (
        <Badge tone="pink" icon={Sparkles}>
          Evaluation to book
        </Badge>
      ),
      detail: `${formatWaiting(item.child)} · ${guardian}`,
    };
  } else {
    const { booking } = item;
    const reason = booking.sort_out_reasons[0] ?? "not_completed";
    copy = {
      title: booking.child.name,
      badge: (
        <Badge tone={REASON_TONE[reason]} hasDot>
          {SORT_OUT_LABEL[reason]}
        </Badge>
      ),
      detail: `${formatDate(booking.scheduled_date)}, ${formatClock(booking.start_time)} · ${booking.staff.name}`,
    };
  }
  return copy;
}

type DateChipProps = { item: BookingTodo };

function DateChip({ item }: DateChipProps): ReactNode {
  if (item.kind === "needs-tutor") {
    return (
      <span
        aria-hidden
        className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-(--tl-warning-tint) text-(--tl-warning)"
      >
        <UserRoundX className="size-[18px]" />
      </span>
    );
  }
  const isEvaluation = item.kind === "evaluation";
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-11 shrink-0 flex-col items-center justify-center rounded-[14px] tabular-nums",
        isEvaluation
          ? "bg-(--tl-pink-tint) text-(--tl-pink-ink)"
          : "bg-(--tl-tint) text-(--tl-primary-ink)",
      )}
    >
      {item.kind === "evaluation" ? (
        <Sparkles className="size-[18px]" />
      ) : (
        <>
          <span className="text-[11px] leading-3 font-semibold uppercase">
            {formatDate(item.booking.scheduled_date, { month: "short" })}
          </span>
          <span className="text-[16px] leading-5 font-bold">
            {formatDate(item.booking.scheduled_date, { day: "numeric" })}
          </span>
        </>
      )}
    </span>
  );
}

type BookingTodoRowProps = {
  item: BookingTodo;
  onOpen: (item: BookingTodo) => void;
};

export default function BookingTodoRow({
  item,
  onOpen,
}: BookingTodoRowProps): ReactNode {
  const copy = getCopy(item);
  return (
    <li className="border-b border-(--tl-border) py-1 last:border-b-0">
      <button
        type="button"
        onClick={() => onOpen(item)}
        aria-label={`Review ${copy.title}`}
        className="group flex min-h-14 w-full cursor-pointer items-start gap-3 rounded-[14px] px-2 py-2.5 text-left transition-colors duration-150 hover:bg-(--tl-tint) active:bg-(--tl-tint-strong)"
      >
        <DateChip item={item} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] leading-6 font-semibold">
            {copy.title}
          </span>
          <span className="mt-0.5 block">{copy.badge}</span>
          <span className="mt-1 block truncate text-[13px] leading-[18px] text-(--tl-muted) tabular-nums">
            {copy.detail}
          </span>
        </span>
        <ChevronRight
          aria-hidden
          className="mt-2 size-5 shrink-0 text-(--tl-muted) transition-transform duration-150 group-hover:translate-x-0.5"
        />
      </button>
    </li>
  );
}
