// The Office Bookings page (/bookings): header, toolbar and week stepper,
// then the week as a List or a Calendar, or Needs attention's list across
// every date. Filters, view, week and page live in the URL; details and
// the booking form open over the page through useBookingOverlays.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import BookingsCalendar from "@/components/bookings-calendar/bookings-calendar";
import { getTodayKey } from "@/components/kit/format";
import { useNow } from "@/components/kit/hooks/use-now";
import { prefersReducedMotion } from "@/components/kit/overlays/use-enter-animation";
import { PageHeader } from "@/components/kit/shell/page-header";
import { useBookingOverlays } from "@/hooks/use-booking-overlays";
import type { BookingTodoItem } from "@/lib/bookings/booking-todo";
import { addDays } from "@/lib/week";
import BookingsToolbar from "@/pages/bookings/components/bookings-toolbar";
import NeedsAttentionContent from "@/pages/bookings/components/needs-attention-content";
import WeekContent from "@/pages/bookings/components/week-content";
import WeekStepper from "@/pages/bookings/components/week-stepper";
import type { CalendarScale } from "@/pages/bookings/components/week-stepper";
import { useBookingDeepLink } from "@/pages/bookings/hooks/use-booking-deep-link";
import { useBookingsUrl } from "@/pages/bookings/hooks/use-bookings-url";
import { useNeedsAttention } from "@/pages/bookings/hooks/use-needs-attention";
import { useWeekList } from "@/pages/bookings/hooks/use-week-list";
import { useAuthStore } from "@/stores/authStore";

const LAST_DAY_OFFSET = 6;

// The day shown in Day view and on phones: the one picked if it is in
// the week, else today when it is, else the week's Monday.
function getShownDay(
  weekStart: string,
  today: string,
  picked: string | null,
): string {
  const weekEnd = addDays(weekStart, LAST_DAY_OFFSET);
  const isInWeek = (day: string) => weekStart <= day && day <= weekEnd;
  let day = weekStart;
  if (picked && isInWeek(picked)) {
    day = picked;
  } else if (isInWeek(today)) {
    day = today;
  }
  return day;
}

export default function BookingsPage(): ReactNode {
  const rootRef = useRef<HTMLDivElement>(null);
  const listTopRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { openBooking, openNewBooking } = useBookingOverlays();
  const isManager = useAuthStore((store) => store.role === "manager");
  const url = useBookingsUrl();
  const { state, view, weekStart } = url;
  const [scale, setScale] = useState<CalendarScale>("week");
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const now = new Date(useNow());
  const today = getTodayKey(now);
  const day = getShownDay(weekStart, today, pickedDay);
  const isNeedsAttention = state.isNeedsAttention;
  const weekList = useWeekList({
    weekStart,
    filters: url.filters,
    page: state.page,
    isEnabled: !isNeedsAttention && view === "list",
  });
  const needsAttention = useNeedsAttention({
    page: state.page,
    isEnabled: isNeedsAttention,
  });
  useBookingDeepLink(rootRef);

  // A page past the end (Bookings resolved, a link kept) moves to the last.
  const pastEndPage =
    weekList.status === "ready" &&
    !weekList.isPaging &&
    state.page > weekList.lastPage
      ? weekList.lastPage
      : null;
  const { setPage } = url;
  useEffect(() => {
    if (pastEndPage !== null) setPage(pastEndPage, true);
  }, [pastEndPage, setPage]);

  function handlePageChange(page: number): void {
    url.setPage(page);
    listTopRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start",
    });
  }

  function handleOpenTodo(item: BookingTodoItem): void {
    if (item.kind === "booking") {
      openBooking(item.booking.id);
    } else if (item.kind === "needs-tutor") {
      navigate(`/families/${item.child.id}?child=${item.child.id}`);
    } else {
      openNewBooking({ kind: "evaluation", childId: item.child.id });
    }
  }

  let content: ReactNode;
  if (isNeedsAttention) {
    content = (
      <NeedsAttentionContent
        list={needsAttention}
        now={now}
        onOpen={handleOpenTodo}
        onPageChange={handlePageChange}
      />
    );
  } else if (view === "list") {
    content = (
      <WeekContent
        list={weekList}
        weekStart={weekStart}
        today={today}
        page={state.page}
        isFiltered={url.isFiltered}
        onOpenBooking={openBooking}
        onPageChange={handlePageChange}
      />
    );
  } else {
    content = (
      <BookingsCalendar
        scale={scale}
        weekStart={weekStart}
        day={day}
        filters={url.filters}
        onDayChange={setPickedDay}
        onOpenBooking={openBooking}
        onNewBooking={(at) =>
          openNewBooking({
            date: at.date,
            startTime: at.startTime,
            userId: at.userId,
          })
        }
      />
    );
  }

  return (
    <div ref={rootRef}>
      <PageHeader
        title="Bookings"
        primaryAction={{
          label: "New booking",
          icon: Plus,
          onClick: () => openNewBooking(),
        }}
      >
        <BookingsToolbar url={url} isManager={isManager} />
        {isNeedsAttention ? (
          <div>
            <h2 className="kit-display text-[17px] leading-6 font-bold">
              All dates · needs attention
            </h2>
            <p className="text-[13px] text-(--tl-muted)">
              Showing everything that needs attention, in To do’s order.
            </p>
          </div>
        ) : (
          <WeekStepper
            weekStart={weekStart}
            currentWeek={url.currentWeek}
            scale={view === "calendar" ? scale : null}
            onWeekChange={url.setWeek}
            onScaleChange={setScale}
          />
        )}
      </PageHeader>
      <div ref={listTopRef} className="scroll-mt-4">
        {content}
      </div>
    </div>
  );
}
