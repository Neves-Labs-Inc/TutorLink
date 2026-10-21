// The row under the toolbar: previous / next week around the range,
// "This week" when off the current week, and in Calendar the Week /
// Day by Staff switch (wide screens only; phones show one day).
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, IconButton } from "@/components/kit/components/button";
import { SegmentedControl } from "@/components/kit/components/tabs";
import { addWeeks } from "@/lib/week";
import { formatWeekRange } from "@/pages/bookings/lib/labels";

export type CalendarScale = "week" | "day";

const SCALE_ITEMS = [
  { id: "week", label: "Week" },
  { id: "day", label: "Day · by Staff" },
];

type WeekStepperProps = {
  weekStart: string;
  currentWeek: string;
  // Null outside Calendar.
  scale: CalendarScale | null;
  onWeekChange: (weekStart: string) => void;
  onScaleChange: (scale: CalendarScale) => void;
};

export default function WeekStepper({
  weekStart,
  currentWeek,
  scale,
  onWeekChange,
  onScaleChange,
}: WeekStepperProps): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center">
        <IconButton
          icon={ChevronLeft}
          label="Previous week"
          onClick={() => onWeekChange(addWeeks(weekStart, -1))}
        />
        <span
          aria-live="polite"
          className="kit-display min-w-[132px] text-center text-[17px] font-bold tabular-nums"
        >
          {formatWeekRange(weekStart)}
        </span>
        <IconButton
          icon={ChevronRight}
          label="Next week"
          onClick={() => onWeekChange(addWeeks(weekStart, 1))}
        />
      </div>
      {weekStart !== currentWeek && (
        <Button variant="ghost" onClick={() => onWeekChange(currentWeek)}>
          This week
        </Button>
      )}
      {scale && (
        <div className="ml-auto hidden @3xl:block">
          <SegmentedControl
            label="Calendar scale"
            activeId={scale}
            onChange={(id) => onScaleChange(id === "day" ? "day" : "week")}
            items={SCALE_ITEMS}
          />
        </div>
      )}
    </div>
  );
}
