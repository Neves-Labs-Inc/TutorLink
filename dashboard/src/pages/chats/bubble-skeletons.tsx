import type { ReactNode } from "react";
import { Skeleton } from "@/components/kit/states/states";
import { cn } from "@/components/kit/tokens";

const BUBBLE_WIDTHS = ["w-3/5", "w-2/5", "w-4/5", "w-1/2", "w-3/5"];

type BubbleSkeletonsProps = { label: string };

// Alternating left and right bubbles while a chat's messages load.
export default function BubbleSkeletons({
  label,
}: BubbleSkeletonsProps): ReactNode {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-4">
      {BUBBLE_WIDTHS.map((width, index) => (
        <div
          key={index}
          className={cn("flex", index % 2 === 0 ? "justify-start" : "justify-end")}
        >
          <Skeleton className={cn("h-12 rounded-[20px]", width)} />
        </div>
      ))}
    </div>
  );
}
