// One Booking in the family week: time, Child, Subject and Staff, in
// the Child's pastel with a coloured edge. Cancelled ones stay visible
// but muted and struck through. The whole block opens the Booking.
import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { cn, TONE_CLASSES } from "@/components/kit/tokens";
import { BAR_CLASSES } from "@/pages/prototype/accounts-staff/lib/child-tones";
import type { ChildTone } from "@/pages/prototype/accounts-staff/lib/child-tones";
import { formatWireTime } from "@/pages/prototype/accounts-staff/lib/labels";
import type { BookingSummary } from "@/pages/prototype/accounts-staff/types/api";

type BookingBlockProps = {
  booking: BookingSummary;
  tone: ChildTone;
  onOpen: (id: string) => void;
};

const STATUS_NOTE: Partial<Record<BookingSummary["status"], string>> = {
  pending: "Pending",
  cancelled: "Cancelled",
};

export default function BookingBlock({ booking, tone, onOpen }: BookingBlockProps): ReactNode {
  const isCancelled = booking.status === "cancelled";
  const isEvaluation = booking.kind === "evaluation";
  const what = isEvaluation ? "Evaluation" : (booking.subject?.name ?? "Tutoring");
  const note = STATUS_NOTE[booking.status];
  const firstName = booking.child.name.split(" ")[0];

  return (
    <button
      type="button"
      onClick={() => onOpen(booking.id)}
      aria-label={`${formatWireTime(booking.start_time)}, ${booking.child.name}, ${what} with ${booking.staff.name}${note ? `, ${note}` : ""}`}
      className={cn(
        "block w-full min-h-11 cursor-pointer rounded-[12px] border-l-4 px-2.5 py-2 text-left transition-[filter] duration-150 hover:brightness-95",
        isCancelled ? "border-l-(--tl-border) bg-(--tl-surface-sunk) text-(--tl-muted)" : cn(TONE_CLASSES[tone], BAR_CLASSES[tone]),
      )}
    >
      <span className="block text-[12px] leading-4 font-semibold tabular-nums">
        {formatWireTime(booking.start_time)}
        {note && <span className="font-normal"> · {note}</span>}
      </span>
      <span className={cn("block truncate text-[14px] leading-5 font-bold", isCancelled && "line-through")}>{firstName}</span>
      <span className="flex items-center gap-1 truncate text-[12px] leading-4">
        {isEvaluation && <Sparkles aria-hidden className="size-3 shrink-0" />}
        <span className="truncate">{what}</span>
      </span>
      <span className="block truncate text-[12px] leading-4 opacity-80">{booking.staff.name}</span>
    </button>
  );
}
