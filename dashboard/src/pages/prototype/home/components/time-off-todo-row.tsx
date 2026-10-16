// A pending Time off request. The whole row opens the request's details,
// where Approve and Decline live (Franklin, 2026-10-15: keeps the list
// calm). A clash with live Bookings shows as a warning here too.
import type { ReactNode } from "react";
import { CalendarX2, ChevronRight } from "lucide-react";
import { Avatar, Badge } from "@/pages/prototype/shell-kit/kit/components/badges";
import { pluralize } from "@/pages/prototype/shell-kit/kit/format";
import {
  formatTimeOffDates,
  ROLE_LABEL,
} from "@/pages/prototype/home/lib/labels";
import type { ExceptionRead } from "@/pages/prototype/home/types/api";

type TimeOffTodoRowProps = {
  item: ExceptionRead;
  onOpen: (item: ExceptionRead) => void;
};

export default function TimeOffTodoRow({
  item,
  onOpen,
}: TimeOffTodoRowProps): ReactNode {
  const name = item.staff.name;
  const clashCount = item.clashing_bookings_count;
  return (
    <li className="border-b border-(--tl-border) py-1 last:border-b-0">
      <button
        type="button"
        onClick={() => onOpen(item)}
        aria-label={`Review time off for ${name}`}
        className="group flex min-h-14 w-full cursor-pointer items-start gap-3 rounded-[14px] px-2 py-2.5 text-left transition-colors duration-150 hover:bg-(--tl-tint) active:bg-(--tl-tint-strong)"
      >
        <Avatar name={name} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2">
            <span className="truncate text-[15px] leading-6 font-semibold">
              {name}
            </span>
            {item.staff.role !== "tutor" && (
              <span className="text-[13px] text-(--tl-muted)">
                {ROLE_LABEL[item.staff.role]}
              </span>
            )}
          </span>
          <span className="block text-[14px] leading-5 text-(--tl-ink-soft) tabular-nums">
            {formatTimeOffDates(item)}
          </span>
          {item.reason && (
            <span className="mt-0.5 line-clamp-1 text-[13px] leading-[18px] text-(--tl-muted)">
              {item.reason}
            </span>
          )}
          {clashCount > 0 && (
            <span className="mt-1.5 block">
              <Badge tone="warning" icon={CalendarX2}>
                {pluralize(clashCount, "Booking", "Bookings")} in these dates
              </Badge>
            </span>
          )}
        </span>
        <span className="mt-0.5 hidden shrink-0 items-center gap-0.5 text-[13px] font-semibold text-(--tl-link) @md:inline-flex">
          Review
          <ChevronRight
            aria-hidden
            className="size-4 transition-transform duration-150 group-hover:translate-x-0.5"
          />
        </span>
        <ChevronRight
          aria-hidden
          className="mt-2 size-5 shrink-0 text-(--tl-muted) @md:hidden"
        />
      </button>
    </li>
  );
}
