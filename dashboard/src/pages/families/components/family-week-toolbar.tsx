// The family week's toolbar: Previous / range / Next on the left, the
// Child legend (2+ Children) and This week on the right.
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, IconButton } from "@/components/kit/components/button";
import { DOT_CLASSES } from "@/components/kit/lib/child-tones";
import type { ChildTone } from "@/components/kit/lib/child-tones";
import { cn } from "@/components/kit/tokens";
import type { Family } from "@/hooks/use-family";
import { getFirstName } from "@/lib/bookings/calendar";
import type { FamilyWeek } from "@/pages/families/hooks/use-family-week";
import { formatWeekRange } from "@/pages/families/lib/family-week";

const MIN_LEGEND_CHILDREN = 2;

type FamilyWeekToolbarProps = {
  week: FamilyWeek;
  family: Family;
  tones: Map<string, ChildTone>;
};

export default function FamilyWeekToolbar({
  week,
  family,
  tones,
}: FamilyWeekToolbarProps): ReactNode {
  const hasLegend = family.children.length >= MIN_LEGEND_CHILDREN;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1">
        <IconButton icon={ChevronLeft} label="Previous week" onClick={week.showPreviousWeek} />
        <p
          aria-live="polite"
          className="min-w-[132px] text-center text-[15px] font-semibold tabular-nums"
        >
          {formatWeekRange(week.weekStart)}
        </p>
        <IconButton icon={ChevronRight} label="Next week" onClick={week.showNextWeek} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {hasLegend && (
          <ul aria-label="Children" className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {family.children.map((child) => {
              const tone = tones.get(child.id) ?? "neutral";
              return (
                <li
                  key={child.id}
                  className="flex items-center gap-1.5 text-[13px] text-(--tl-ink-soft)"
                >
                  {/* From the fifth Child on, the name alone. */}
                  {tone !== "neutral" && (
                    <span aria-hidden className={cn("size-2.5 rounded-full", DOT_CLASSES[tone])} />
                  )}
                  {getFirstName(child.name)}
                </li>
              );
            })}
          </ul>
        )}
        <Button variant="outline" onClick={week.showThisWeek} disabled={week.isThisWeek}>
          This week
        </Button>
      </div>
    </div>
  );
}
