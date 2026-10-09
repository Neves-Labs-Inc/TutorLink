import { CalendarDays, List } from "lucide-react";

import type { BookingView } from "@/lib/booking-calendar/booking-calendar";
import { cn } from "@/lib/utils";

type ViewToggleProps = {
  value: BookingView;
  onChange: (view: BookingView) => void;
};

const toggleClasses =
  "inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px md:min-h-0 md:py-1.5";
const toggleOn = "bg-primary text-primary-foreground";
const toggleOff = "text-muted-foreground hover:bg-muted hover:text-foreground";

// Same markup as the toggle on the Bookings page, which swaps onto this later.
export default function ViewToggle({
  value,
  onChange,
}: ViewToggleProps): React.ReactNode {
  const isCalendar = value === "calendar";

  return (
    <div
      role="group"
      aria-label="View"
      className="ml-auto inline-flex gap-1 rounded-lg border border-border p-1"
    >
      <button
        type="button"
        aria-pressed={!isCalendar}
        className={cn(toggleClasses, isCalendar ? toggleOff : toggleOn)}
        onClick={() => onChange("list")}
      >
        <List aria-hidden="true" className="size-4" />
        List
      </button>
      <button
        type="button"
        aria-pressed={isCalendar}
        className={cn(toggleClasses, isCalendar ? toggleOn : toggleOff)}
        onClick={() => onChange("calendar")}
      >
        <CalendarDays aria-hidden="true" className="size-4" />
        Calendar
      </button>
    </div>
  );
}
