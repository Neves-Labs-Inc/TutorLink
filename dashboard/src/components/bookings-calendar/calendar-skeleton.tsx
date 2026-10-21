// The calendar while its week loads with nothing cached: the grid's
// full height on wide screens, the strip and rows on phones, so nothing
// jumps when the week arrives.
import type { ReactNode } from "react";
import { ListSkeleton, Skeleton } from "@/components/kit/states/states";
import { CARD, cn, EYEBROW } from "@/components/kit/tokens";

const DAYS_IN_WEEK = 7;
const GRID_HOURS = 12;
const HOUR_PX = 64;
const AXIS_PX = 56;

// Fixed placeholder Bookings: column, top (px) and height (px).
const PLACEHOLDER_BLOCKS = [
  { column: 1, top: 64, height: 64 },
  { column: 2, top: 448, height: 96 },
  { column: 4, top: 192, height: 64 },
  { column: 5, top: 512, height: 96 },
];

const COLUMN_TEMPLATE = `${AXIS_PX}px repeat(${DAYS_IN_WEEK}, minmax(0, 1fr))`;
const DAY_INDEXES = Array.from({ length: DAYS_IN_WEEK }, (_, index) => index);

type CalendarSkeletonProps = { isWide: boolean };

export default function CalendarSkeleton({ isWide }: CalendarSkeletonProps): ReactNode {
  if (!isWide) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-7 gap-1">
          {DAY_INDEXES.map((index) => (
            <Skeleton key={index} className="h-16 rounded-[16px]" />
          ))}
        </div>
        <Skeleton className="h-6 w-1/2 rounded-full" />
        <ListSkeleton rows={3} label="Loading bookings" />
      </div>
    );
  }

  return (
    <div role="status" aria-label="Loading bookings" className={cn(CARD, "overflow-hidden")}>
      <div style={{ gridTemplateColumns: COLUMN_TEMPLATE }} className="grid">
        <div className="border-b border-(--tl-border)" />
        {DAY_INDEXES.map((index) => (
          <div
            key={index}
            className="flex flex-col items-center border-b border-l border-(--tl-border) px-2 py-3"
          >
            {/* Same line box and disc as TimeGrid's day header, so the body doesn't shift. */}
            <span className={cn(EYEBROW, "flex items-center")}>
              <span aria-hidden className="invisible">M</span>
              <Skeleton className="h-3 w-8 rounded-full" />
            </span>
            <Skeleton className="mt-0.5 size-9 rounded-full" />
          </div>
        ))}
        <div style={{ height: GRID_HOURS * HOUR_PX }} />
        {DAY_INDEXES.map((index) => (
          <div key={index} className="relative border-l border-(--tl-border)">
            {PLACEHOLDER_BLOCKS.filter((block) => block.column === index).map((block) => (
              <div
                key={block.top}
                style={{ top: block.top, height: block.height }}
                className="absolute inset-x-1"
              >
                <Skeleton className="size-full rounded-[12px]" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
