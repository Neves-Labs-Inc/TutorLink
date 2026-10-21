// The family page while its household loads: the page's own shape, so
// nothing jumps when it swaps in (no fade). The back link stays real.
import type { ReactNode } from "react";
import { ListSkeleton, Skeleton } from "@/components/kit/states/states";
import { CARD, cn } from "@/components/kit/tokens";
import { FAMILY_SECTIONS } from "@/pages/families/lib/family-classes";

const CHILD_CARD_COUNT = 2;
const GUARDIAN_ROW_COUNT = 2;

type FamilyPageSkeletonProps = { backLink: ReactNode };

export default function FamilyPageSkeleton({
  backLink,
}: FamilyPageSkeletonProps): ReactNode {
  return (
    <>
      <div className="pt-5 @5xl:pt-6">
        <div className="mb-3">{backLink}</div>
      </div>
      <div role="status" aria-label="Loading family">
        <div className="pb-6 @5xl:pb-8">
          <Skeleton className="h-[42px] w-2/3 max-w-[360px] rounded-full" />
          <Skeleton className="mt-2 h-4 w-48 rounded-full" />
        </div>
        <div className={FAMILY_SECTIONS}>
          <div>
            <Skeleton className="mb-3 h-3 w-28 rounded-full" />
            <div className="grid gap-3 @3xl:grid-cols-2">
              {Array.from({ length: CHILD_CARD_COUNT }, (_, index) => (
                <div key={index} className={cn(CARD, "h-[148px]")} />
              ))}
            </div>
          </div>
          <div className={cn(CARD, "h-[320px]")} />
          <ListSkeleton rows={GUARDIAN_ROW_COUNT} label="Loading Guardians" />
        </div>
      </div>
    </>
  );
}
