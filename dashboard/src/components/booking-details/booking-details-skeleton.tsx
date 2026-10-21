// Booking details while the Booking loads: the header's badges and title,
// then five detail rows, so the content swaps in without a jump.
import type { ReactNode } from "react";
import { Skeleton } from "@/components/kit/states/states";

const ROW_COUNT = 5;

type BookingDetailsSkeletonProps = { part: "header" | "body" };

export default function BookingDetailsSkeleton({
  part,
}: BookingDetailsSkeletonProps): ReactNode {
  if (part === "header") {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex gap-2">
          <Skeleton className="h-7 w-24 rounded-full" />
          <Skeleton className="h-7 w-20 rounded-full" />
        </div>
        <Skeleton className="mt-2 h-[30px] w-1/2 rounded-full" />
        <Skeleton className="h-3.5 w-1/3 rounded-full" />
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-label="Loading booking"
      className="flex flex-col gap-4"
    >
      {Array.from({ length: ROW_COUNT }, (_, index) => (
        <div key={index} className="flex gap-3">
          <Skeleton className="size-10 shrink-0 rounded-[14px]" />
          <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
            <Skeleton className="h-3 w-16 rounded-full" />
            <Skeleton className="h-4 w-2/3 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
