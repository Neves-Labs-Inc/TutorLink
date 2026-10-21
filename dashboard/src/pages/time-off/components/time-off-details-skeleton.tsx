// The details body while it loads, shaped like the real one so nothing
// jumps when it swaps in.
import type { ReactNode } from "react";
import { Skeleton } from "@/components/kit/states/states";

const DETAIL_ROWS = 3;

export default function TimeOffDetailsSkeleton(): ReactNode {
  return (
    <div role="status" aria-label="Loading time off">
      <div className="mb-4 flex items-center gap-3">
        <Skeleton className="size-10 shrink-0 rounded-full" />
        <Skeleton className="h-4 w-40 rounded-full" />
      </div>
      <Skeleton className="h-8 w-3/4 rounded-full" />
      <Skeleton className="mt-4 h-[72px] rounded-[16px]" />
      <div className="mt-6 flex flex-col gap-5">
        {Array.from({ length: DETAIL_ROWS }, (_, index) => (
          <div key={index} className="flex gap-3">
            <Skeleton className="size-10 shrink-0 rounded-[14px]" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-16 rounded-full" />
              <Skeleton className="h-4 w-32 rounded-full" />
            </div>
          </div>
        ))}
        <Skeleton className="h-24 rounded-[16px]" />
      </div>
    </div>
  );
}
