// My sessions (/sessions): the Tutor's landing page. The next Session as a
// large card on top, then the rest by day; Past pages back through what's
// over. Every row opens the Session details at /sessions/:id, and the
// Upcoming/Past choice (?view=past) and Past page (?page=) ride along.
import { useRef } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck } from "lucide-react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Pager } from "@/components/kit/components/pager";
import { SegmentedControl } from "@/components/kit/components/tabs";
import {
  formatDay,
  getGreeting,
  getRelativeDayLabel,
  getTodayKey,
  pluralize,
} from "@/components/kit/format";
import { useNow } from "@/components/kit/hooks/use-now";
import { prefersReducedMotion } from "@/components/kit/overlays/use-enter-animation";
import { EyebrowPill, PageHeader } from "@/components/kit/shell/page-header";
import { EmptyState, ErrorState, ListSkeleton, Skeleton } from "@/components/kit/states/states";
import { CARD, HEADING, cn } from "@/components/kit/tokens";
import type { BookingSummary } from "@/lib/queries/bookings";
import { meQueries } from "@/lib/queries/me";
import { PAST_SESSIONS_PAGE_SIZE, sessionQueries } from "@/lib/queries/sessions";
import { NextUpCard } from "@/pages/sessions/components/next-up-card";
import { SessionDetails } from "@/pages/sessions/components/session-details";
import { SessionRow } from "@/pages/sessions/components/session-row";
import { useIsKitWide } from "@/pages/sessions/hooks/use-is-kit-wide";
import { getFirstName } from "@/pages/sessions/lib/session-labels";
import {
  findNextUp,
  getPreviousDayKey,
  groupByDay,
} from "@/pages/sessions/lib/session-rules";

type View = "upcoming" | "past";

const SESSIONS_PATH = "/sessions";
const PAST_VIEW: View = "past";

export default function MySessionsPage(): ReactNode {
  const rootRef = useRef<HTMLDivElement>(null);
  const listTopRef = useRef<HTMLDivElement>(null);
  const isWide = useIsKitWide(rootRef);
  const navigate = useNavigate();
  const { search } = useLocation();
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const view: View = searchParams.get("view") === PAST_VIEW ? "past" : "upcoming";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  const now = new Date(useNow());
  const today = getTodayKey(now);
  const me = useQuery(meQueries.detail());
  const upcoming = useQuery(sessionQueries.upcoming(today));
  const past = useQuery({
    ...sessionQueries.past(getPreviousDayKey(today), page),
    enabled: view === "past",
  });
  const shown = view === "upcoming" ? upcoming : past;

  function handleOpen(sessionId: string): void {
    navigate({ pathname: `${SESSIONS_PATH}/${sessionId}`, search });
  }

  function handleClose(): void {
    navigate({ pathname: SESSIONS_PATH, search });
  }

  function handleChangeView(next: string): void {
    setSearchParams(next === PAST_VIEW ? { view: PAST_VIEW } : {});
  }

  function handleChangePage(next: number): void {
    setSearchParams({ view: PAST_VIEW, page: String(next) });
    listTopRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start",
    });
  }

  const upcomingItems = upcoming.data?.items ?? [];
  const nextUp = findNextUp(upcomingItems, now);
  const firstName = me.data ? getFirstName(me.data.name) : null;

  let content: ReactNode;
  if (shown.isPending) {
    content = <SessionsSkeleton view={view} />;
  } else if (shown.isError) {
    content = (
      <ErrorState
        title="Couldn’t load your sessions"
        body="Check your connection and try again."
        onRetry={() => void shown.refetch()}
        isRetrying={shown.isFetching}
      />
    );
  } else if (view === "upcoming") {
    content = (
      <UpcomingList
        sessions={upcomingItems}
        nextUp={nextUp}
        today={today}
        now={now}
        onOpen={handleOpen}
      />
    );
  } else {
    content = (
      <PastList
        sessions={past.data?.items ?? []}
        total={past.data?.total ?? 0}
        page={page}
        isPaging={past.isPlaceholderData}
        today={today}
        now={now}
        onOpen={handleOpen}
        onPageChange={handleChangePage}
      />
    );
  }

  return (
    <div ref={rootRef}>
      <PageHeader
        eyebrow={
          <EyebrowPill>
            {formatDay(today, { weekday: "long", month: "long", day: "numeric" })}
          </EyebrowPill>
        }
        title={firstName ? `${getGreeting(now)}, ${firstName}` : getGreeting(now)}
        description={getDescription(upcoming, today, nextUp)}
      >
        <SegmentedControl
          label="Which sessions"
          activeId={view}
          onChange={handleChangeView}
          isFullWidth={!isWide}
          items={[
            { id: "upcoming", label: "Upcoming" },
            { id: "past", label: "Past" },
          ]}
        />
      </PageHeader>
      <div ref={listTopRef} className="scroll-mt-4">
        {content}
      </div>
      <SessionDetails
        sessionId={id ?? null}
        officePhone={me.data?.office_phone ?? null}
        now={now}
        onClose={handleClose}
      />
    </div>
  );
}

type UpcomingQuery = { isPending: boolean; data?: { items: BookingSummary[] } };

function getDescription(
  upcoming: UpcomingQuery,
  today: string,
  nextUp: BookingSummary | null,
): ReactNode {
  if (upcoming.isPending) return <Skeleton className="inline-block h-4 w-40 rounded-full" />;
  if (!upcoming.data) return undefined;

  const todayCount = upcoming.data.items.filter(
    (session) => session.scheduled_date === today && session.status !== "cancelled",
  ).length;
  let description = "No sessions coming up.";
  if (todayCount > 0) {
    description = `${pluralize(todayCount, "session", "sessions")} today.`;
  } else if (nextUp) {
    description = "No sessions today.";
  }
  return description;
}

type DayGroupsProps = {
  sessions: BookingSummary[];
  today: string;
  now: Date;
  onOpen: (sessionId: string) => void;
};

function DayGroups({ sessions, today, now, onOpen }: DayGroupsProps): ReactNode {
  return groupByDay(sessions).map((group) => (
    <section key={group.dayKey} aria-labelledby={`day-${group.dayKey}`}>
      <h2 id={`day-${group.dayKey}`} className="flex items-baseline gap-2 px-1 pb-3">
        <span className={HEADING}>{getRelativeDayLabel(group.dayKey, today)}</span>
        <span className="text-[14px] text-(--tl-muted)">
          {formatDay(group.dayKey, { month: "short", day: "numeric" })}
        </span>
      </h2>
      <ul className="flex flex-col gap-3">
        {group.sessions.map((session) => (
          <li key={session.id}>
            <SessionRow session={session} now={now} onOpen={() => onOpen(session.id)} />
          </li>
        ))}
      </ul>
    </section>
  ));
}

type UpcomingListProps = DayGroupsProps & { nextUp: BookingSummary | null };

function UpcomingList({ sessions, nextUp, today, now, onOpen }: UpcomingListProps): ReactNode {
  if (sessions.length === 0) {
    return <EmptyState icon={CalendarCheck} title="Nothing booked yet" />;
  }

  return (
    <div className="flex flex-col gap-8">
      {nextUp && <NextUpCard session={nextUp} now={now} onOpen={() => onOpen(nextUp.id)} />}
      <DayGroups
        sessions={sessions.filter((session) => session !== nextUp)}
        today={today}
        now={now}
        onOpen={onOpen}
      />
    </div>
  );
}

type PastListProps = DayGroupsProps & {
  total: number;
  page: number;
  isPaging: boolean;
  onPageChange: (page: number) => void;
};

function PastList({
  sessions,
  total,
  page,
  isPaging,
  today,
  now,
  onOpen,
  onPageChange,
}: PastListProps): ReactNode {
  if (total === 0) {
    return <EmptyState icon={CalendarCheck} title="No past sessions" />;
  }

  // A page past the end (old link, or fewer Sessions now) keeps the Pager to step back.
  return (
    <>
      {sessions.length === 0 ? (
        <EmptyState icon={CalendarCheck} title="No past sessions" />
      ) : (
        <div className="flex flex-col gap-8">
          <DayGroups sessions={sessions} today={today} now={now} onOpen={onOpen} />
        </div>
      )}
      <div className="mt-6">
        <Pager
          page={page}
          pageSize={PAST_SESSIONS_PAGE_SIZE}
          total={total}
          onPageChange={onPageChange}
          label="Past sessions pages"
          isDisabled={isPaging}
        />
      </div>
    </>
  );
}

// The Next up shape is decoration; the list skeleton carries the status.
function SessionsSkeleton({ view }: { view: View }): ReactNode {
  return (
    <div className="flex flex-col gap-8">
      {view === "upcoming" && (
        <Skeleton className={cn(CARD, "h-[168px] rounded-[20px] @2xl:h-[120px]")} />
      )}
      <ListSkeleton rows={3} label="Loading your sessions" />
    </div>
  );
}
