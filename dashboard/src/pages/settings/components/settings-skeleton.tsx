// Settings while it loads: three cards where the groups will be, lined
// up with the groups column (past the 200px jump column and its gap).
import type { ReactNode } from "react";
import { Skeleton } from "@/components/kit/states/states";
import { CARD, cn } from "@/components/kit/tokens";
import FieldGrid from "@/pages/settings/components/field-grid";

// Fields per skeleton card.
const SKELETON_CARDS = [4, 3, 3];

export default function SettingsSkeleton(): ReactNode {
  return (
    <div
      role="status"
      aria-label="Loading settings"
      className="flex max-w-[880px] flex-col gap-6 @5xl:ml-[232px]"
    >
      {SKELETON_CARDS.map((fields, card) => (
        <div
          key={card}
          className={cn(CARD, "flex flex-col gap-6 p-4 @2xl:p-5")}
        >
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-40 rounded-full" />
            <Skeleton className="h-3 w-72 max-w-full rounded-full" />
          </div>
          <FieldGrid>
            {Array.from({ length: fields }, (_, field) => (
              <div key={field} className="flex flex-col gap-2">
                <Skeleton className="h-3 w-32 rounded-full" />
                <Skeleton className="h-11 w-full max-w-[320px] rounded-full" />
              </div>
            ))}
          </FieldGrid>
        </div>
      ))}
    </div>
  );
}
