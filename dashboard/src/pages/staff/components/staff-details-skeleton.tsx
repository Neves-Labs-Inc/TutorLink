// Staff details while they load: header badge, identity, a tab bar and
// four DetailRows, so the panel doesn't jump when they land.
import type { ReactNode } from "react";
import { Skeleton } from "@/components/kit/states/states";

const DETAIL_ROWS = 4;
const TABS = 3;

export default function StaffDetailsSkeleton(): ReactNode {
  return (
    <div role="status" aria-label="Loading Staff details">
      <div className="flex items-center gap-4">
        <Skeleton className="size-12 shrink-0 rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-48 rounded-full" />
          <Skeleton className="h-3 w-20 rounded-full" />
        </div>
      </div>
      <div className="mt-5 flex h-12 items-center gap-4 border-b border-(--tl-border)">
        {Array.from({ length: TABS }, (_, index) => (
          <Skeleton key={index} className="h-4 w-20 rounded-full" />
        ))}
      </div>
      <div className="flex flex-col gap-5 pt-5">
        {Array.from({ length: DETAIL_ROWS }, (_, index) => (
          <div key={index} className="flex gap-3">
            <Skeleton className="size-10 shrink-0 rounded-[14px]" />
            <div className="flex flex-1 flex-col gap-2 pt-1">
              <Skeleton className="h-3 w-16 rounded-full" />
              <Skeleton className="h-4 w-40 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
