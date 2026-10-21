import type { ReactNode } from "react";
import { Skeleton } from "@/components/kit/states/states";
import { CARD, cn } from "@/components/kit/tokens";

const WEEK_DAYS = 7;

type AvailabilitySkeletonProps = { isEditable: boolean };

// The editor's shape while the week loads: summary row, then 7 days.
export default function AvailabilitySkeleton({
  isEditable,
}: AvailabilitySkeletonProps): ReactNode {
  return (
    <div
      role="status"
      aria-label="Loading availability"
      className="flex flex-col gap-4"
    >
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-3.5 w-48 rounded-full" />
        {isEditable && <Skeleton className="h-11 w-24 rounded-full" />}
      </div>
      <div className={cn(CARD, "divide-y divide-(--tl-border)")}>
        {Array.from({ length: WEEK_DAYS }, (_, index) => (
          <div
            key={index}
            data-skeleton-day
            className="flex items-center gap-6 px-4 py-4 @2xl:px-6"
          >
            <Skeleton className="h-4 w-24 rounded-full" />
            <Skeleton className="h-11 flex-1 rounded-[16px]" />
          </div>
        ))}
      </div>
    </div>
  );
}
