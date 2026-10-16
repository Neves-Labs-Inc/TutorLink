// My sessions: the Tutor's landing page (#186). Phone first: the next
// Session as a large card on top, then the rest by day. Upcoming / Past
// switch the list; every row opens the Session details.
import { useState } from "react";
import type { ReactNode } from "react";
import { CalendarCheck, MapPin, Signpost } from "lucide-react";
import { formatDay, getGreeting, pluralize } from "@/pages/prototype/shell-kit/kit/format";
import { CARD, cn, HEADING } from "@/pages/prototype/shell-kit/kit/tokens";
import { KindBadge } from "@/pages/prototype/shell-kit/kit/components/badges";
import { SegmentedControl } from "@/pages/prototype/shell-kit/kit/components/tabs";
import { EyebrowPill, PageHeader } from "@/pages/prototype/shell-kit/kit/shell/page-header";
import {
  EmptyState,
  ErrorState,
  ListSkeleton,
} from "@/pages/prototype/shell-kit/kit/states/states";
import SessionRow from "@/pages/prototype/tutor-timeoff/components/session-row";
import {
  formatClock,
  getFirstName,
  getPlaceLine,
  getSubjectLine,
} from "@/pages/prototype/tutor-timeoff/lib/labels";
import { hasFinished, NOW, TODAY } from "@/pages/prototype/tutor-timeoff/lib/rules";
import type { Phase } from "@/pages/prototype/tutor-timeoff/hooks/use-load-phase";
import type { BookingDetail, MeRead } from "@/pages/prototype/tutor-timeoff/types/api";

type Range = "upcoming" | "past";

const MINUTES_PER_HOUR = 60;
const MS_PER_MINUTE = 60_000;

function getRelativeDay(dayKey: string): string {
  const tomorrow = new Date(`${TODAY}T12:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = tomorrow.toLocaleDateString("en-CA");
  let label = formatDay(dayKey, { weekday: "long" });
  if (dayKey === TODAY) {
    label = "Today";
  } else if (dayKey === tomorrowKey) {
    label = "Tomorrow";
  }
  return label;
}

function getStartsIn(session: BookingDetail): string {
  const minutes = Math.round(
    (new Date(`${session.scheduled_date}T${session.start_time}`).getTime() -
      new Date(NOW).getTime()) /
      MS_PER_MINUTE,
  );
  let text = `${getRelativeDay(session.scheduled_date)} at ${formatClock(session.start_time)}`;
  if (minutes <= 0) {
    text = "Happening now";
  } else if (session.scheduled_date === TODAY && minutes < MINUTES_PER_HOUR) {
    text = `In ${minutes} min`;
  } else if (session.scheduled_date === TODAY) {
    text = `Today at ${formatClock(session.start_time)}`;
  }
  return text;
}

type DayGroup = { dayKey: string; sessions: BookingDetail[] };

function groupByDay(sessions: BookingDetail[]): DayGroup[] {
  const keys = [...new Set(sessions.map((session) => session.scheduled_date))];
  return keys.map((dayKey) => ({
    dayKey,
    sessions: sessions.filter((session) => session.scheduled_date === dayKey),
  }));
}

function bySchedule(a: BookingDetail, b: BookingDetail): number {
  return `${a.scheduled_date}${a.start_time}`.localeCompare(`${b.scheduled_date}${b.start_time}`);
}

type MySessionsScreenProps = {
  me: MeRead;
  phase: Phase;
  isRetrying: boolean;
  onRetry: () => void;
  sessions: BookingDetail[];
  onOpen: (session: BookingDetail) => void;
};

export default function MySessionsScreen({
  me,
  phase,
  isRetrying,
  onRetry,
  sessions,
  onOpen,
}: MySessionsScreenProps): ReactNode {
  const [range, setRange] = useState<Range>("upcoming");
  const own = sessions.filter((session) => session.staff.id === me.id);
  const upcoming = own.filter((session) => !hasFinished(session)).sort(bySchedule);
  const past = own.filter(hasFinished).sort((a, b) => bySchedule(b, a));
  const next = upcoming.find((session) => session.status !== "cancelled") ?? null;
  const todayCount = upcoming.filter(
    (session) => session.scheduled_date === TODAY && session.status !== "cancelled",
  ).length;
  const listed = range === "upcoming" ? upcoming.filter((session) => session !== next) : past;

  let summary = "No sessions coming up.";
  if (phase !== "ready") {
    summary = "Your sessions, with notes and directions.";
  } else if (next) {
    summary = `${pluralize(todayCount, "session", "sessions")} today.`;
  }

  let content: ReactNode;
  if (phase === "loading") {
    content = <ListSkeleton rows={4} label="Loading your sessions" />;
  } else if (phase === "error") {
    content = (
      <ErrorState
        title="Couldn’t load your sessions"
        body="Check your connection and try again."
        onRetry={onRetry}
        isRetrying={isRetrying}
      />
    );
  } else if (range === "upcoming" && !next) {
    content = (
      <EmptyState
        icon={CalendarCheck}
        title="Nothing booked yet"
        body="New sessions show up here as soon as the office or a Guardian books you. Check My availability is up to date."
      />
    );
  } else if (range === "past" && past.length === 0) {
    content = (
      <EmptyState
        icon={CalendarCheck}
        title="No past sessions"
        body="Sessions move here once they’re over."
      />
    );
  } else {
    content = (
      <div className="flex flex-col gap-8">
        {range === "upcoming" && next && <NextUpCard session={next} onOpen={onOpen} />}
        {groupByDay(listed).map((group) => (
          <section key={group.dayKey} aria-labelledby={`day-${group.dayKey}`}>
            <h2 id={`day-${group.dayKey}`} className="flex items-baseline gap-2 px-1 pb-3">
              <span className={HEADING}>{getRelativeDay(group.dayKey)}</span>
              <span className="text-[14px] text-(--tl-muted)">
                {formatDay(group.dayKey, { month: "short", day: "numeric" })}
              </span>
            </h2>
            <ul className="flex flex-col gap-3">
              {group.sessions.map((session) => (
                <li key={session.id}>
                  <SessionRow session={session} onOpen={() => onOpen(session)} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <EyebrowPill>
            {formatDay(TODAY, { weekday: "long", month: "long", day: "numeric" })}
          </EyebrowPill>
        }
        title={`${getGreeting(NOW)}, ${getFirstName(me.name)}`}
        description={summary}
      >
        <SegmentedControl
          label="Which sessions"
          activeId={range}
          // Ids come from the two items below.
          onChange={(id) => setRange(id as Range)}
          items={[
            { id: "upcoming", label: "Upcoming" },
            { id: "past", label: "Past" },
          ]}
        />
      </PageHeader>
      {content}
    </>
  );
}

type NextUpCardProps = {
  session: BookingDetail;
  onOpen: (session: BookingDetail) => void;
};

// The one thing a Tutor needs at a glance: who, when, where. Tapping
// opens the details (directions, notes); no buttons on the card.
function NextUpCard({ session, onOpen }: NextUpCardProps): ReactNode {
  const hasDirections = Boolean(session.home?.directions);
  return (
    <section aria-label="Next up">
      <button
        type="button"
        onClick={() => onOpen(session)}
        className={cn(
          CARD,
          "group flex w-full cursor-pointer flex-col gap-4 border-(--tl-hero) bg-(--tl-tint) p-5 text-left transition-colors duration-150 hover:bg-(--tl-tint-strong) @2xl:flex-row @2xl:items-center @2xl:gap-6 @2xl:p-6",
        )}
      >
        <span className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold tracking-[0.14em] text-(--tl-primary-ink) uppercase">
            Next up · {getStartsIn(session)}
          </span>
          <span className="kit-display text-[28px] leading-9 font-light tabular-nums">
            {formatClock(session.start_time)} – {formatClock(session.end_time)}
          </span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1.5 @2xl:border-l @2xl:border-(--tl-hero) @2xl:pl-6">
          <span className="flex flex-wrap items-center gap-2">
            <span className="kit-display text-[20px] leading-7 font-bold">{session.child.name}</span>
            {session.kind === "evaluation" && <KindBadge kind="evaluation" />}
          </span>
          <span className="text-[15px] text-(--tl-ink-soft)">{getSubjectLine(session)}</span>
          <span className="flex items-start gap-2 text-[14px] text-(--tl-ink-soft)">
            <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-(--tl-muted)" />
            <span className="min-w-0">{getPlaceLine(session)}</span>
          </span>
          {hasDirections && (
            <span className="flex items-center gap-2 text-[13px] font-medium text-(--tl-primary-ink)">
              <Signpost aria-hidden className="size-4 shrink-0" />
              Has directions · tap for details
            </span>
          )}
        </span>
      </button>
    </section>
  );
}
