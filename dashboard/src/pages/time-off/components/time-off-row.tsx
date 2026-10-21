// One Time off in a divided card list (`<ul>` of these). The whole row
// opens the details; there are no acts on the row. `own` is a Tutor's or
// Manager's list (Plane chip, length and clash line); `compact` is the
// Staff details tab. The row queries its own width: below 448px the badge
// drops under the dates, from 448px it trails them.
import type { ReactNode } from "react";
import { CalendarX2, ChevronRight, Plane } from "lucide-react";
import { TimeOffBadge } from "@/components/kit/components/badges";
import { pluralize } from "@/components/kit/format";
import { cn } from "@/components/kit/tokens";
import type { ExceptionRead } from "@/lib/queries/time-off";
import {
  formatTimeOffDates,
  formatTimeOffLength,
} from "@/pages/time-off/lib/time-off-copy";
import { getTimeOffBadgeStatus } from "@/pages/time-off/lib/time-off-rules";

export type TimeOffRowVariant = "own" | "compact";

type TimeOffRowProps = {
  item: ExceptionRead;
  variant: TimeOffRowVariant;
  onOpen: (id: string) => void;
};

function getMeta(item: ExceptionRead, variant: TimeOffRowVariant): string {
  return variant === "own"
    ? [formatTimeOffLength(item), item.reason].filter(Boolean).join(" · ")
    : (item.reason ?? "No reason given");
}

export default function TimeOffRow({
  item,
  variant,
  onOpen,
}: TimeOffRowProps): ReactNode {
  const isOwnVariant = variant === "own";
  const isClosed =
    item.status === "rejected" ||
    item.status === "cancelled" ||
    item.status === "expired";
  const count = item.clashing_bookings_count;
  const badge = <TimeOffBadge status={getTimeOffBadgeStatus(item.status)} />;
  return (
    <li className="@container">
      <button
        type="button"
        onClick={() => onOpen(item.id)}
        className="group flex min-h-[72px] w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-(--tl-tint) focus-visible:-outline-offset-2! active:bg-(--tl-tint-strong) @2xl:gap-4 @2xl:px-6"
      >
        {isOwnVariant && (
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-(--tl-yellow-tint) text-(--tl-yellow-ink)">
            <Plane aria-hidden className="size-[18px]" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span
            data-part="dates"
            className={cn(
              "block text-[15px] leading-6 font-semibold tabular-nums",
              isClosed && "text-(--tl-muted)",
            )}
          >
            {formatTimeOffDates(item)}
          </span>
          <span
            data-part="meta"
            className="block truncate text-[13px] leading-[18px] text-(--tl-muted)"
          >
            {getMeta(item, variant)}
          </span>
          {isOwnVariant && count > 0 && (
            <span className="mt-1 flex items-center gap-1.5 text-[13px] leading-[18px] font-medium text-(--tl-warning)">
              <CalendarX2 aria-hidden className="size-3.5 shrink-0" />
              {pluralize(count, "session", "sessions")} in these dates
            </span>
          )}
          <span data-part="badge-below" className="mt-1.5 flex @md:hidden">
            {badge}
          </span>
        </span>
        <span data-part="badge-trailing" className="hidden @md:flex">
          {badge}
        </span>
        <ChevronRight
          aria-hidden
          className="size-5 shrink-0 text-(--tl-muted) transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0"
        />
      </button>
    </li>
  );
}
