// The pieces Child and Guardian details share while they load, fail or
// miss: tickets 06 and 08 build on these.
import type { ReactNode } from "react";
import { Avatar } from "@/components/kit/components/badges";
import { Skeleton } from "@/components/kit/states/states";

const SKELETON_ROWS = 4;

type DetailsSkeletonProps = { label: string };

// The body while the record loads: identity, then four detail rows.
export function DetailsSkeleton({ label }: DetailsSkeletonProps): ReactNode {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Skeleton className="size-12 shrink-0 rounded-full" />
        <Skeleton className="h-7 w-1/2 rounded-full" />
      </div>
      <div className="flex flex-col gap-5">
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <div key={index} className="flex items-center gap-3">
            <Skeleton className="size-10 shrink-0 rounded-[14px]" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-20 rounded-full" />
              <Skeleton className="h-4 w-1/2 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// The header slot's stand-in for the Archived badge.
export function DetailsHeaderSkeleton(): ReactNode {
  return <Skeleton className="h-7 w-24 rounded-full" />;
}

type DetailsIdentityProps = { name: string };

export function DetailsIdentity({ name }: DetailsIdentityProps): ReactNode {
  return (
    <div className="flex min-w-0 items-center gap-4">
      <Avatar name={name} size="lg" />
      <h2 className="kit-display min-w-0 truncate text-[28px] leading-9 font-light">
        {name}
      </h2>
    </div>
  );
}
