// My sessions: the Tutor's landing page. The next session sits on top,
// then today, then later days.
import { useState } from "react";
import type { ReactNode } from "react";
import { CalendarCheck, Sparkles } from "lucide-react";
import {
  CURRENT_USER,
  getSessionsFor,
  NOW,
  TODAY,
} from "@/pages/prototype/shell-kit/kit/mock-data";
import type { Booking, Role } from "@/pages/prototype/shell-kit/kit/mock-data";
import {
  formatDay,
  formatTime,
  getDayKey,
  getGreeting,
  getRelativeDayLabel,
  groupByDay,
  pluralize,
} from "@/pages/prototype/shell-kit/kit/format";
import { HEADING } from "@/pages/prototype/shell-kit/kit/tokens";
import { SegmentedControl } from "@/pages/prototype/shell-kit/kit/components/tabs";
import {
  EyebrowPill,
  PageHeader,
} from "@/pages/prototype/shell-kit/kit/shell/page-header";
import { EmptyState } from "@/pages/prototype/shell-kit/kit/states/states";
import BookingRow from "@/pages/prototype/shell-kit/screens/booking-row";
import SessionDetail from "@/pages/prototype/shell-kit/screens/session-detail";

type MySessionsPageProps = { role: Role };

export default function MySessionsPage({
  role,
}: MySessionsPageProps): ReactNode {
  const [range, setRange] = useState("upcoming");
  const [openSession, setOpenSession] = useState<Booking | null>(null);
  const user = CURRENT_USER[role];
  const sessions = getSessionsFor(user.name);
  const upcoming = sessions.filter((session) => session.start >= NOW);
  const past = sessions.filter((session) => session.start < NOW);
  const todayCount = upcoming.filter(
    (session) => getDayKey(session.start) === TODAY,
  ).length;
  const next = upcoming[0] ?? null;
  const groups = groupByDay(range === "upcoming" ? upcoming : past);

  const summary = next
    ? `${pluralize(todayCount, "session", "sessions")} today. Next: ${next.child} at ${formatTime(next.start)}.`
    : "No sessions coming up.";

  return (
    <>
      <PageHeader
        eyebrow={
          <EyebrowPill>
            {formatDay(TODAY, { weekday: "long", month: "long", day: "numeric" })}
          </EyebrowPill>
        }
        title={`${getGreeting(NOW)}, ${user.first}`}
        description={summary}
      >
        <SegmentedControl
          label="Which sessions"
          activeId={range}
          onChange={setRange}
          items={[
            { id: "upcoming", label: "Upcoming" },
            { id: "past", label: "Past" },
          ]}
        />
      </PageHeader>
      {groups.length === 0 && (
        <EmptyState
          icon={CalendarCheck}
          title={range === "upcoming" ? "Nothing booked yet" : "No past sessions"}
          body="New sessions show up here as soon as the office or a Guardian books you."
        />
      )}
      <div className="flex flex-col gap-8">
        {groups.map((group) => (
          <section key={group.dayKey} aria-labelledby={`s-${group.dayKey}`}>
            <h2
              id={`s-${group.dayKey}`}
              className="flex items-baseline gap-2 px-1 pb-3"
            >
              <span className={HEADING}>{getRelativeDayLabel(group.dayKey)}</span>
              <span className="text-[14px] text-(--tl-muted)">
                {formatDay(group.dayKey, { month: "short", day: "numeric" })}
              </span>
            </h2>
            <div className="flex flex-col gap-3">
              {group.items.map((session) => (
                <div key={session.id} className="relative">
                  {session.id === next?.id && range === "upcoming" && (
                    <span className="mb-2 inline-flex h-7 items-center gap-1.5 rounded-full bg-(--tl-tint-strong) px-3 text-[12px] font-semibold tracking-[0.1em] text-(--tl-primary-ink) uppercase">
                      <Sparkles aria-hidden className="size-3.5" />
                      Next up
                    </span>
                  )}
                  <BookingRow
                    booking={session}
                    onOpen={setOpenSession}
                    isTutorView
                  />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      <SessionDetail
        session={openSession}
        onClose={() => setOpenSession(null)}
        phoneMode="page"
      />
    </>
  );
}
