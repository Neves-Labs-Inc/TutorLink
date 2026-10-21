// Seven day buttons for the shown week: the phone agenda's day picker,
// and Day by Staff's on wide screens. A dot marks days with Bookings,
// in warning when one of them needs attention.
import type { ReactNode } from "react";
import { formatDay } from "@/components/kit/format";
import { cn } from "@/components/kit/tokens";
import { getBookingsOn, getWeekDays, needsAttention } from "@/lib/bookings/calendar";
import type { BookingSummary } from "@/lib/queries/bookings";

function formatLongDay(day: string): string {
  return formatDay(day, { weekday: "long", month: "long", day: "numeric" });
}

function getDotClass(count: number, hasAttention: boolean, isSelected: boolean): string {
  let dot = "bg-transparent";
  if (hasAttention) {
    // On the primary fill the warning dot needs a light ring to read.
    dot = cn("bg-(--tl-warning)", isSelected && "ring-2 ring-(--tl-on-primary)");
  } else if (count > 0) {
    dot = isSelected ? "bg-(--tl-on-primary)" : "bg-(--tl-primary)";
  }
  return dot;
}

type DayStripProps = {
  weekStart: string;
  day: string;
  today: string;
  bookings: BookingSummary[];
  onDayChange: (day: string) => void;
};

export default function DayStrip({
  weekStart,
  day,
  today,
  bookings,
  onDayChange,
}: DayStripProps): ReactNode {
  return (
    <div role="group" aria-label="Day" className="grid w-full grid-cols-7 gap-1">
      {getWeekDays(weekStart).map((key) => {
        const isSelected = key === day;
        const dayBookings = getBookingsOn(bookings, key);
        const count = dayBookings.length;
        const noun = count === 1 ? "booking" : "bookings";
        return (
          <button
            key={key}
            type="button"
            aria-pressed={isSelected}
            aria-label={`${formatLongDay(key)}, ${count} ${noun}`}
            onClick={() => onDayChange(key)}
            className={cn(
              "flex min-h-16 min-w-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-[16px] transition-colors duration-150",
              isSelected
                ? "bg-(--tl-primary) text-(--tl-on-primary)"
                : "bg-(--tl-surface) text-(--tl-ink-soft) hover:bg-(--tl-tint) active:bg-(--tl-tint-strong)",
              key === today && !isSelected && "ring-2 ring-(--tl-primary) ring-inset",
            )}
          >
            <span className="text-[12px] font-semibold uppercase">
              {formatDay(key, { weekday: "narrow" })}
            </span>
            <span className="kit-display text-[17px] leading-6 font-bold">
              {formatDay(key, { day: "numeric" })}
            </span>
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                getDotClass(count, dayBookings.some(needsAttention), isSelected),
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
