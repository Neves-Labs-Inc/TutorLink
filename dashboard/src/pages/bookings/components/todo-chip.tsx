// The leading chip of a To do Bookings row, the same as Home's: the
// Booking's date, a Needs a Tutor mark, or an Evaluation-to-book mark.
import type { ReactNode } from "react";
import { Sparkles, UserRoundX } from "lucide-react";
import { formatDay } from "@/components/kit/format";
import { cn } from "@/components/kit/tokens";
import type { BookingTodoItem } from "@/lib/bookings/booking-todo";

const CHIP = "flex size-11 shrink-0 items-center justify-center rounded-[14px]";

type TodoChipProps = { item: BookingTodoItem };

export default function TodoChip({ item }: TodoChipProps): ReactNode {
  let chip: ReactNode;
  if (item.kind === "needs-tutor") {
    chip = (
      <span
        aria-hidden
        className={cn(CHIP, "bg-(--tl-warning-tint) text-(--tl-warning)")}
      >
        <UserRoundX className="size-[18px]" />
      </span>
    );
  } else if (item.kind === "evaluation") {
    chip = (
      <span
        aria-hidden
        className={cn(CHIP, "bg-(--tl-pink-tint) text-(--tl-pink-ink)")}
      >
        <Sparkles className="size-[18px]" />
      </span>
    );
  } else {
    const day = item.booking.scheduled_date;
    chip = (
      <span
        aria-hidden
        className={cn(
          CHIP,
          "flex-col bg-(--tl-tint) text-(--tl-primary-ink) tabular-nums",
        )}
      >
        <span className="text-[12px] leading-3 font-semibold uppercase">
          {formatDay(day, { month: "short" })}
        </span>
        <span className="text-[16px] leading-5 font-bold">
          {formatDay(day, { day: "numeric" })}
        </span>
      </span>
    );
  }
  return chip;
}
