// Bookings by week for the whole family, past and upcoming, opening on
// the current week. Blocks take their Child's tone in family order and
// open Booking details over the page; an action there refreshes the week
// (details invalidate every Booking query).
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import { getChildTones } from "@/components/kit/lib/child-tones";
import { InlineError } from "@/components/kit/states/states";
import { CARD, cn, EYEBROW } from "@/components/kit/tokens";
import type { Family } from "@/hooks/use-family";
import FamilyWeekDays from "@/pages/families/components/family-week-days";
import FamilyWeekSkeleton from "@/pages/families/components/family-week-skeleton";
import FamilyWeekToolbar from "@/pages/families/components/family-week-toolbar";
import { useFamilyWeek } from "@/pages/families/hooks/use-family-week";
import { SECTION_HEAD } from "@/pages/families/lib/family-classes";
import { getBookingsUrl } from "@/pages/families/lib/family-week";

const HEADING_ID = "family-week";

type FamilyWeekSectionProps = { family: Family };

export default function FamilyWeekSection({ family }: FamilyWeekSectionProps): ReactNode {
  const navigate = useNavigate();
  // Archived Children included: their past Bookings still belong here.
  const childIds = family.children.map((child) => child.id);
  const tones = getChildTones(childIds);
  const week = useFamilyWeek(childIds);

  let body: ReactNode;
  if (week.state === "loading") {
    body = <FamilyWeekSkeleton />;
  } else if (week.state === "error") {
    body = (
      <div className="mt-3">
        <InlineError
          message="Couldn’t load Bookings. Check your connection."
          onRetry={week.retry}
          isRetrying={week.isRetrying}
        />
      </div>
    );
  } else if (week.state === "empty") {
    body = (
      <div className="mt-3 flex flex-col items-center gap-2 rounded-[16px] bg-(--tl-surface-sunk) px-4 py-10 text-center">
        <CalendarDays aria-hidden className="size-6 text-(--tl-muted)" />
        <p className="text-[15px] font-semibold">Nothing booked this week</p>
      </div>
    );
  } else {
    body = (
      <FamilyWeekDays
        weekStart={week.weekStart}
        today={week.today}
        bookings={week.bookings}
        tones={tones}
      />
    );
  }

  return (
    <section aria-labelledby={HEADING_ID} className="@container">
      <div className={SECTION_HEAD}>
        <h2 id={HEADING_ID} className={EYEBROW}>
          Bookings by week
        </h2>
        <Button variant="ghost" onClick={() => navigate(getBookingsUrl(childIds))}>
          See all in Bookings
        </Button>
      </div>
      <div className={cn(CARD, "p-3 @2xl:p-4")}>
        <FamilyWeekToolbar week={week} family={family} tones={tones} />
        {body}
      </div>
    </section>
  );
}
