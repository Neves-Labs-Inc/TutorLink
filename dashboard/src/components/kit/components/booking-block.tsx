// The one Booking block for both calendars: the time grid (layout "fill")
// and the family week list (layout "stack"). It takes display strings, so
// it knows nothing about the API. Colour is never the only signal: the
// aria-label carries time, name, kind and status.
import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import type { BookingStatusWire } from "@/components/kit/components/badges";
import { BOOKING_REASON } from "@/components/kit/lib/booking-reason";
import type { BookingReasonKey } from "@/components/kit/lib/booking-reason";
import { BAR_CLASSES } from "@/components/kit/lib/child-tones";
import type { ChildTone } from "@/components/kit/lib/child-tones";
import { cn, TONE_CLASSES } from "@/components/kit/tokens";

const STATUS_LABEL: Record<BookingStatusWire, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  completed: "Completed",
  didnt_happen: "Didn’t happen",
  cancelled: "Cancelled",
};

// Completed and Confirmed need no note: the aria-label has the status.
const NOTED_STATUSES: BookingStatusWire[] = ["pending", "didnt_happen", "cancelled"];

// Block heights (px) at which lines 2, 3 and 4 appear in the fill layout.
const NAME_LINE_MIN_PX = 40;
const WHAT_LINE_MIN_PX = 64;
const STAFF_LINE_MIN_PX = 88;

export type BookingBlockDisplay = {
  time: string;
  // The name shown on the block (a first name from the fifth Child on).
  name: string;
  // The full Child name for the aria-label; defaults to `name`.
  fullName?: string;
  // The Subject, or "Evaluation".
  what: string;
  isEvaluation?: boolean;
  staffName: string;
  // Shows the Staff line (the grid hides it in a Staff column).
  showsStaff?: boolean;
  status: BookingStatusWire;
  reason?: BookingReasonKey;
  tone: ChildTone;
};

type BookingBlockProps = BookingBlockDisplay & {
  layout: "fill" | "stack";
  // Fill layout: the box height decides how many lines fit.
  heightPx?: number;
  onOpen: () => void;
};

function getAriaLabel(props: BookingBlockProps): string {
  const { time, name, fullName, what, staffName, status } = props;
  const reason = status === "cancelled" ? undefined : props.reason;
  const base = `${time}, ${fullName ?? name}, ${what} with ${staffName}, ${STATUS_LABEL[status]}`;
  return reason ? `${base}, needs attention: ${BOOKING_REASON[reason].label}` : base;
}

function getVisibleLines(props: BookingBlockProps): number {
  const { layout, heightPx = Infinity, showsStaff = true } = props;
  const lastLine = showsStaff ? 4 : 3;
  if (layout === "stack") return lastLine;
  if (heightPx >= STAFF_LINE_MIN_PX) return lastLine;
  if (heightPx >= WHAT_LINE_MIN_PX) return 3;
  if (heightPx >= NAME_LINE_MIN_PX) return 2;
  return 1;
}

export default function BookingBlock(props: BookingBlockProps): ReactNode {
  const { time, name, what, isEvaluation, staffName, status, tone, layout, onOpen } = props;
  // Cancelled wins over everything, so a reason no longer shows.
  const reason = status === "cancelled" ? undefined : props.reason;
  const isCancelled = status === "cancelled";
  const note = NOTED_STATUSES.includes(status) ? STATUS_LABEL[status] : null;
  const ReasonIcon = reason ? BOOKING_REASON[reason].icon : null;
  const lines = getVisibleLines(props);

  let look = cn(TONE_CLASSES[tone], BAR_CLASSES[tone]);
  if (reason) {
    look =
      "border-2 border-l-4 border-(--tl-warning) bg-(--tl-warning-tint) text-(--tl-warning)";
  }
  if (isCancelled) {
    look =
      "border-l-(--tl-border) bg-(--tl-surface-sunk) text-(--tl-muted)";
  }

  const timeLine = (
    <span className="truncate text-[12px] leading-4 font-semibold whitespace-nowrap tabular-nums">
      {time}
      {note && <span className="font-normal"> · {note}</span>}
    </span>
  );
  const nameLine = (
    <span className="flex min-w-0 items-center gap-1">
      {ReasonIcon && <ReasonIcon aria-hidden className="size-4 shrink-0" />}
      <span
        className={cn(
          "truncate text-[14px] leading-5 font-bold",
          isCancelled && "line-through",
        )}
      >
        {name}
      </span>
    </span>
  );

  return (
    <button
      type="button"
      data-booking-block
      onClick={onOpen}
      aria-label={getAriaLabel(props)}
      className={cn(
        "cursor-pointer overflow-hidden rounded-[12px] border-l-4 px-2.5 text-left transition-[box-shadow,transform] duration-150 hover:shadow-(--tl-shadow-raised) active:scale-[0.98] motion-reduce:active:scale-100",
        "flex flex-col",
        layout === "stack" ? "min-h-11 w-full py-2" : "size-full py-1.5",
        look,
      )}
    >
      {lines === 1 ? (
        <span className="flex min-w-0 items-center gap-2">
          {timeLine}
          {nameLine}
        </span>
      ) : (
        <>
          {timeLine}
          {nameLine}
        </>
      )}
      {lines >= 3 && (
        <span className="flex items-center gap-1 text-[12px] leading-4">
          {isEvaluation && <Sparkles aria-hidden className="size-3 shrink-0" />}
          <span className="truncate">{what}</span>
        </span>
      )}
      {lines >= 4 && (
        <span className="truncate text-[12px] leading-4">{staffName}</span>
      )}
    </button>
  );
}
