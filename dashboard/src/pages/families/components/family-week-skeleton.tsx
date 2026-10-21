// An uncached week while it loads, in the grid's and the list's shape so
// the card doesn't jump when the Bookings arrive.
import type { ReactNode } from "react";
import { Skeleton } from "@/components/kit/states/states";
import { cn } from "@/components/kit/tokens";

const DAYS_IN_WEEK = 7;
// Monday, Wednesday and Thursday get a second placeholder block.
const DAYS_WITH_TWO = new Set([0, 2, 3]);
const DAY_INDEXES = Array.from({ length: DAYS_IN_WEEK }, (_, index) => index);

const BLOCK = "h-[76px] rounded-[12px]";

export default function FamilyWeekSkeleton(): ReactNode {
  return (
    <div role="status" aria-label="Loading Bookings">
      <ol className="mt-3 hidden grid-cols-7 gap-1.5 @3xl:grid">
        {DAY_INDEXES.map((index) => (
          <li
            key={index}
            className="flex min-h-40 flex-col gap-1.5 rounded-[14px] bg-(--tl-surface-sunk) p-1.5"
          >
            <Skeleton className="mx-1 my-1 h-3 w-10 rounded-full" />
            <Skeleton className={BLOCK} />
            {DAYS_WITH_TWO.has(index) && <Skeleton className={BLOCK} />}
          </li>
        ))}
      </ol>
      <ol className="mt-3 flex flex-col gap-3 @3xl:hidden">
        {DAY_INDEXES.map((index) => (
          <li key={index} className="flex gap-3">
            <div className="w-[72px] shrink-0 pt-2">
              <Skeleton className="h-4 w-14 rounded-full" />
            </div>
            <Skeleton className={cn(BLOCK, "flex-1")} />
          </li>
        ))}
      </ol>
    </div>
  );
}
