// Home: To do as one card per group, side by side from 768px: Admins get
// Chats and Time off, Managers just Chats (Evaluations and Bookings moved
// to Bookings ▸ To sort out). Each card
// shows up to 3 rows and "See all"; an empty group says "All clear" so
// the grid keeps its shape. Below: today's Bookings for Admins, My
// sessions today for Managers. Every To do row opens its record; Time
// off's Approve / Decline sit beside the row, never inside it.
import { useState } from "react";
import type { ReactNode } from "react";
import {
  CalendarClock,
  Check,
  ChevronRight,
  MessageCircle,
  Plane,
  Sparkles,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  BOOKINGS,
  CURRENT_USER,
  getSessionsFor,
  getTodoFor,
  NOW,
  TIME_OFF,
  TODAY,
} from "@/pages/prototype/shell-kit/kit/mock-data";
import type {
  Booking,
  Role,
  TimeOff,
  TimeOffStatus,
  TodoItem,
  TodoKind,
} from "@/pages/prototype/shell-kit/kit/mock-data";
import {
  formatDay,
  getDayKey,
  getGreeting,
  pluralize,
} from "@/pages/prototype/shell-kit/kit/format";
import { CARD, cn, HEADING } from "@/pages/prototype/shell-kit/kit/tokens";
import { CountBadge } from "@/pages/prototype/shell-kit/kit/components/badges";
import { Button, TextLink } from "@/pages/prototype/shell-kit/kit/components/button";
import {
  EyebrowPill,
  PageHeader,
} from "@/pages/prototype/shell-kit/kit/shell/page-header";
import type { NavId } from "@/pages/prototype/shell-kit/kit/shell/nav";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";
import { EmptyState } from "@/pages/prototype/shell-kit/kit/states/states";
import AccountDetails from "@/pages/prototype/shell-kit/screens/account-details";
import type { AccountEntry } from "@/pages/prototype/shell-kit/screens/account-details";
import BookingDetail from "@/pages/prototype/shell-kit/screens/booking-detail";
import BookingRow from "@/pages/prototype/shell-kit/screens/booking-row";
import { BookingsTable } from "@/pages/prototype/shell-kit/screens/people-tables";
import SessionDetail from "@/pages/prototype/shell-kit/screens/session-detail";
import TimeOffDetail from "@/pages/prototype/shell-kit/screens/time-off-detail";

const ITEMS_PER_GROUP = 3;

type GroupStyle = {
  title: string;
  icon: LucideIcon;
  chip: string;
  cue: string;
  seeAll: NavId;
};

const GROUPS: Record<TodoKind, GroupStyle> = {
  chat: {
    title: "Chats",
    icon: MessageCircle,
    chip: "bg-(--tl-tint-strong) text-(--tl-primary-ink)",
    cue: "Open chat",
    seeAll: "chats",
  },
  evaluation: {
    title: "Evaluations",
    icon: Sparkles,
    chip: "bg-(--tl-pink-tint) text-(--tl-pink-ink)",
    cue: "Book evaluation",
    seeAll: "accounts",
  },
  booking: {
    title: "Bookings",
    icon: CalendarClock,
    chip: "bg-(--tl-green-tint) text-(--tl-green-ink)",
    cue: "Sort it out",
    seeAll: "bookings",
  },
  "time-off": {
    title: "Time off",
    icon: Plane,
    chip: "bg-(--tl-yellow-tint) text-(--tl-yellow-ink)",
    cue: "Review",
    seeAll: "time-off",
  },
};

// Evaluations and Bookings live on Bookings ▸ To sort out now.
const ADMIN_GROUPS: TodoKind[] = ["chat", "time-off"];
const MANAGER_GROUPS: TodoKind[] = ["chat"];

type HomePageProps = { role: Role; onNavigate: (id: NavId) => void };

export default function HomePage({
  role,
  onNavigate,
}: HomePageProps): ReactNode {
  const [items, setItems] = useState<TodoItem[]>(() => getTodoFor(role));
  const [openBooking, setOpenBooking] = useState<Booking | null>(null);
  const [openSession, setOpenSession] = useState<Booking | null>(null);
  const [openTimeOff, setOpenTimeOff] = useState<TimeOff | null>(null);
  const [accountStack, setAccountStack] = useState<AccountEntry[]>([]);
  const { showToast } = useToast();
  const user = CURRENT_USER[role];
  const isManager = role === "manager";
  const groupKinds = isManager ? MANAGER_GROUPS : ADMIN_GROUPS;
  const todayBookings = BOOKINGS.filter(
    (booking) => getDayKey(booking.start) === TODAY,
  );
  // Managers also teach: their Home shows their own sessions, not the
  // office's whole day (that stays on Bookings).
  const mySessionsToday = getSessionsFor(user.name).filter(
    (session) => getDayKey(session.start) === TODAY,
  );
  const todayLabel = isManager
    ? pluralize(mySessionsToday.length, "session", "sessions")
    : pluralize(todayBookings.length, "booking", "bookings");

  function handleOpen(item: TodoItem): void {
    if (item.kind === "chat") {
      onNavigate("chats");
    } else if (item.kind === "evaluation") {
      setAccountStack([{ kind: "child", id: item.refId }]);
    } else if (item.kind === "booking") {
      setOpenBooking(BOOKINGS.find((booking) => booking.id === item.refId) ?? null);
    } else {
      setOpenTimeOff(TIME_OFF.find((entry) => entry.id === item.refId) ?? null);
    }
  }

  function handleDecide(refId: string, decision: TimeOffStatus): void {
    const before = items;
    const item = items.find((current) => current.refId === refId);
    setItems(items.filter((current) => current.refId !== refId));
    showToast({
      tone: "success",
      message: `${decision} time off for ${item?.title.replace(/ \(.*\)$/, "") ?? "Staff"}.`,
      actionLabel: "Undo",
      onAction: () => setItems(before),
    });
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <EyebrowPill>
            {formatDay(TODAY, { weekday: "long", month: "long", day: "numeric" })}
          </EyebrowPill>
        }
        title={`${getGreeting(NOW)}, ${user.first}`}
        description={`${pluralize(items.length, "thing", "things")} in To do, ${todayLabel} today.`}
      />

      <section aria-labelledby="home-todo">
        <div className="flex items-center gap-3 pb-3">
          <h2 id="home-todo" className={HEADING}>
            To do
          </h2>
          <CountBadge count={items.length} tone="pink" label="waiting" />
        </div>
        <div
          className="grid gap-4 @3xl:grid-cols-2"
        >
          {groupKinds.map((kind) => (
            <TodoCard
              key={kind}
              kind={kind}
              items={items.filter((item) => item.kind === kind)}
              canDecideTimeOff={role === "admin"}
              onOpen={handleOpen}
              onDecide={handleDecide}
              onSeeAll={() => onNavigate(GROUPS[kind].seeAll)}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="home-today" className="mt-10">
        {isManager ? (
          <>
            <h2 id="home-today" className={cn(HEADING, "pb-3")}>
              My sessions today
            </h2>
            {mySessionsToday.length === 0 ? (
              <EmptyState
                icon={CalendarClock}
                title="No sessions today"
                body="Your own teaching shows here. The office’s whole day is on Bookings."
              />
            ) : (
              <div className="flex flex-col gap-3">
                {mySessionsToday.map((session) => (
                  <BookingRow
                    key={session.id}
                    booking={session}
                    onOpen={setOpenSession}
                    isTutorView
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex items-baseline justify-between pb-3">
              <h2 id="home-today" className={HEADING}>
                Today’s bookings
              </h2>
              <TextLink onClick={() => onNavigate("bookings")}>Open Bookings</TextLink>
            </div>
            <BookingsTable rows={todayBookings} onOpen={setOpenBooking} />
          </>
        )}
      </section>

      <BookingDetail
        booking={openBooking}
        onClose={() => setOpenBooking(null)}
        phoneMode="page"
        backLabel="Home"
      />
      <SessionDetail
        session={openSession}
        onClose={() => setOpenSession(null)}
        phoneMode="page"
      />
      <TimeOffDetail
        item={openTimeOff}
        backLabel="Home"
        onClose={() => setOpenTimeOff(null)}
        onDecide={
          role === "admin"
            ? (entry, status) => handleDecide(entry.id, status)
            : undefined
        }
      />
      <AccountDetails stack={accountStack} onChange={setAccountStack} rootLabel="Home" />
    </>
  );
}

type TodoCardProps = {
  kind: TodoKind;
  items: TodoItem[];
  canDecideTimeOff: boolean;
  onOpen: (item: TodoItem) => void;
  onDecide: (refId: string, decision: TimeOffStatus) => void;
  onSeeAll: () => void;
};

function TodoCard({
  kind,
  items,
  canDecideTimeOff,
  onOpen,
  onDecide,
  onSeeAll,
}: TodoCardProps): ReactNode {
  const style = GROUPS[kind];
  const Icon = style.icon;
  const headingId = `todo-${kind}`;
  return (
    <section
      aria-labelledby={headingId}
      className={cn(CARD, "flex flex-col p-4 @2xl:p-5")}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "inline-flex size-10 shrink-0 items-center justify-center rounded-[14px]",
            style.chip,
          )}
        >
          <Icon aria-hidden className="size-[18px]" />
        </span>
        <h3 id={headingId} className="kit-display flex-1 text-[17px] leading-6 font-bold">
          {style.title}
        </h3>
        {items.length > 0 && <CountBadge count={items.length} tone="pink" label="waiting" />}
      </div>

      {items.length === 0 ? (
        <p className="mt-3 flex flex-1 items-center gap-2 rounded-[16px] bg-(--tl-surface-sunk) px-4 py-4 text-[14px] text-(--tl-muted)">
          <Check aria-hidden className="size-4 text-(--tl-success)" />
          All clear
        </p>
      ) : (
        <ul className="-mx-2 mt-3 flex flex-1 flex-col">
          {items.slice(0, ITEMS_PER_GROUP).map((item) => (
            <li key={item.id} className="border-b border-(--tl-border) py-1 last:border-b-0">
              <button
                type="button"
                onClick={() => onOpen(item)}
                className="group flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-[14px] px-2 py-2 text-left transition-colors duration-150 hover:bg-(--tl-tint) active:bg-(--tl-tint-strong)"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] leading-6 font-semibold">
                    {item.title}
                  </span>
                  <span className="line-clamp-2 block text-[13px] leading-[18px] text-(--tl-muted)">
                    {item.detail}
                  </span>
                </span>
                <span className="hidden shrink-0 items-center gap-0.5 text-[13px] font-semibold text-(--tl-link) @md:inline-flex">
                  {style.cue}
                  <ChevronRight aria-hidden className="size-4 transition-transform duration-150 group-hover:translate-x-0.5" />
                </span>
                <ChevronRight aria-hidden className="size-5 shrink-0 text-(--tl-muted) @md:hidden" />
              </button>
              {kind === "time-off" && canDecideTimeOff && (
                <div className="flex gap-2 px-2 pb-1">
                  <Button
                    variant="soft"
                    icon={Check}
                    onClick={() => onDecide(item.refId, "Approved")}
                    aria-label={`Approve time off for ${item.title}`}
                  >
                    Approve
                  </Button>
                  <Button
                    icon={X}
                    onClick={() => onDecide(item.refId, "Declined")}
                    aria-label={`Decline time off for ${item.title}`}
                  >
                    Decline
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 border-t border-(--tl-border) pt-1">
        <TextLink onClick={onSeeAll}>
          See all{items.length > 0 ? ` ${items.length}` : ""}
          <ChevronRight aria-hidden className="size-4" />
        </TextLink>
      </div>
    </section>
  );
}
