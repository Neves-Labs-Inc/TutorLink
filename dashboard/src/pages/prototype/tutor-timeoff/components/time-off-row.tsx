// A Time off list row. The whole row opens the details; status is a
// badge with its word, never colour alone. No actions on the row.
import type { ReactNode } from "react";
import { CalendarX2, ChevronRight, Plane } from "lucide-react";
import { Avatar } from "@/pages/prototype/shell-kit/kit/components/badges";
import { pluralize } from "@/pages/prototype/shell-kit/kit/format";
import { cn } from "@/pages/prototype/shell-kit/kit/tokens";
import { TimeOffStatusBadge } from "@/pages/prototype/tutor-timeoff/components/time-off-status";
import {
  formatLength,
  formatTimeOffDates,
  ROLE_LABEL,
} from "@/pages/prototype/tutor-timeoff/lib/labels";
import type { ExceptionRead } from "@/pages/prototype/tutor-timeoff/types/api";

type TimeOffRowProps = {
  item: ExceptionRead;
  // Office lists lead with the person; own lists with the dates.
  isPersonShown?: boolean;
  onOpen: (item: ExceptionRead) => void;
};

export default function TimeOffRow({
  item,
  isPersonShown = false,
  onOpen,
}: TimeOffRowProps): ReactNode {
  const isClosed = item.status === "cancelled" || item.status === "expired" || item.status === "rejected";
  const meta = [formatLength(item), item.reason].filter(Boolean).join(" · ");
  // The row queries its own width: below 448px the badge drops under
  // the dates so they don't wrap.
  return (
    <div className="@container">
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="group flex min-h-[76px] w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-(--tl-tint) focus-visible:-outline-offset-2 @2xl:gap-4 @2xl:px-6"
      >
        {isPersonShown ? (
          <Avatar name={item.staff.name} />
        ) : (
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-(--tl-yellow-tint) text-(--tl-yellow-ink)">
            <Plane aria-hidden className="size-[18px]" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          {isPersonShown && (
            <span className="block truncate text-[15px] leading-6 font-semibold">
              {item.staff.name}
              <span className="font-normal text-(--tl-muted)"> · {ROLE_LABEL[item.staff.role]}</span>
            </span>
          )}
          <span
            className={cn(
              "block text-[15px] leading-6 tabular-nums",
              isPersonShown ? "text-[14px] text-(--tl-ink-soft)" : "font-semibold",
              isClosed && !isPersonShown && "text-(--tl-muted)",
            )}
          >
            {formatTimeOffDates(item)}
          </span>
          <span className="block truncate text-[13px] leading-[18px] text-(--tl-muted)">{meta}</span>
          {item.clashing_bookings_count > 0 && (
            <span className="mt-1 flex items-center gap-1.5 text-[13px] leading-[18px] font-medium text-(--tl-warning)">
              <CalendarX2 aria-hidden className="size-3.5" />
              {pluralize(
                item.clashing_bookings_count,
                isPersonShown ? "Booking" : "session",
                isPersonShown ? "Bookings" : "sessions",
              )}{" "}
              in these dates
            </span>
          )}
          <span className="mt-1.5 flex @md:hidden">
            <TimeOffStatusBadge status={item.status} />
          </span>
        </span>
        <span className="hidden @md:flex">
          <TimeOffStatusBadge status={item.status} />
        </span>
        <ChevronRight
          aria-hidden
          className="size-5 shrink-0 text-(--tl-muted) transition-transform duration-150 group-hover:translate-x-0.5"
        />
      </button>
    </div>
  );
}
