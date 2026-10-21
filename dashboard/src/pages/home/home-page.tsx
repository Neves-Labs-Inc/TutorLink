// Home (/home) for the Office (TutorLink#189, DESIGN §11.2). To do holds
// Chats, Bookings and, for Admins, Time off; each card loads and fails on
// its own. Below it, Admins see Today's bookings and Managers their own
// sessions today.
import { useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { TextLink } from "@/components/kit/components/button";
import { formatDay, getGreeting } from "@/components/kit/format";
import { EyebrowPill, PageHeader } from "@/components/kit/shell/page-header";
import { Skeleton } from "@/components/kit/states/states";
import { cn, HEADING } from "@/components/kit/tokens";
import { LandingWelcome } from "@/components/layout/landing-welcome";
import { useBookingOverlays } from "@/hooks/use-booking-overlays";
import type { Role } from "@/lib/auth/auth";
import type { ChildSummary } from "@/lib/queries/children";
import BookingsTodoCard from "@/pages/home/components/bookings-todo-card";
import ChatsTodoCard from "@/pages/home/components/chats-todo-card";
import EvaluationOverlay from "@/pages/home/components/evaluation-overlay";
import FreshnessCue from "@/pages/home/components/freshness-cue";
import MySessionsToday from "@/pages/home/components/my-sessions-today";
import TimeOffTodoCard from "@/pages/home/components/time-off-todo-card";
import TodayBookings from "@/pages/home/components/today-bookings";
import { useHomeData } from "@/pages/home/hooks/use-home-data";
import type { HomeData } from "@/pages/home/hooks/use-home-data";
import { getHomeSummary } from "@/pages/home/lib/home-labels";
import { useAuthStore } from "@/stores/authStore";

const LONG_DATE: Intl.DateTimeFormatOptions = {
  weekday: "long",
  month: "long",
  day: "numeric",
};

export default function HomePage(): ReactNode {
  // The route guard has settled an Office role before Home renders.
  const role = useAuthStore((state) => state.role);
  if (role === null) return null;

  return <HomeScreen role={role} />;
}

type HomeScreenProps = { role: Role };

function HomeScreen({ role }: HomeScreenProps): ReactNode {
  const home = useHomeData(role);
  const navigate = useNavigate();
  const { openBooking, openNewBooking } = useBookingOverlays();
  const [evaluationChild, setEvaluationChild] = useState<ChildSummary | null>(
    null,
  );
  const { isManager, timeOff, firstName, now } = home;

  function handleBookEvaluation(child: ChildSummary): void {
    setEvaluationChild(null);
    openNewBooking({ kind: "evaluation", childId: child.id });
  }

  return (
    <>
      <PageHeader
        eyebrow={<EyebrowPill>{formatDay(home.today, LONG_DATE)}</EyebrowPill>}
        title={firstName ? `${getGreeting(now)}, ${firstName}` : getGreeting(now)}
        description={getDescription(home)}
      />

      <div className="flex flex-col gap-6">
        <LandingWelcome />
        <section aria-labelledby="home-todo">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-3">
            <h2 id="home-todo" className={HEADING}>
              To do
            </h2>
            <FreshnessCue freshness={home.freshness} />
          </div>
          <div
            className={cn(
              "grid items-start gap-4 @3xl:grid-cols-2",
              !isManager && "@6xl:grid-cols-3",
            )}
          >
            <ChatsTodoCard group={home.chats} userId={home.userId} />
            <BookingsTodoCard
              group={home.bookings}
              isManager={isManager}
              now={now}
              onOpenBooking={openBooking}
              onOpenEvaluation={setEvaluationChild}
            />
            {timeOff && (
              // No lone half-width card at two columns.
              <div className="min-w-0 @3xl:col-span-2 @6xl:col-span-1">
                <TimeOffTodoCard group={timeOff} />
              </div>
            )}
          </div>
        </section>

        <section aria-labelledby="home-today">
          <div className="flex items-baseline justify-between gap-3 pb-3">
            <h2 id="home-today" className={HEADING}>
              {isManager ? "My sessions today" : "Today’s bookings"}
            </h2>
            {!isManager && (
              <TextLink onClick={() => navigate("/bookings")}>
                Open Bookings
              </TextLink>
            )}
          </div>
          {isManager ? (
            <MySessionsToday
              group={home.todayBookings}
              now={now}
              onOpen={openBooking}
            />
          ) : (
            <TodayBookings
              group={home.todayBookings}
              today={home.today}
              now={now}
              onOpen={openBooking}
            />
          )}
        </section>
      </div>

      <EvaluationOverlay
        child={evaluationChild}
        now={now}
        onClose={() => setEvaluationChild(null)}
        onBook={handleBookEvaluation}
      />
    </>
  );
}

// A skeleton on first load; the summary once everything has loaded; left
// out while any block failed, so it never shows a partial count.
function getDescription(home: HomeData): ReactNode {
  const blocks = [home.chats, home.bookings, home.timeOff, home.todayBookings];
  if (blocks.some((block) => block?.phase === "loading")) {
    return <Skeleton className="mt-2 h-4 w-64 max-w-full rounded-full" />;
  }
  if (home.todoCount === null) return undefined;

  return getHomeSummary(
    home.todoCount,
    home.todayBookings.data?.length ?? 0,
    home.isManager,
  );
}
