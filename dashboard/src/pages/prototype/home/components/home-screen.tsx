// Home for the Office (TutorLink#189; Bookings back in To do 2026-10-15,
// replacing the To sort out banner).
// Admin:   To do = Chats | Bookings | Time off (three across from a
//          1152px window, two then one below that); then Today's
//          bookings as a table.
// Manager: To do = Chats | Bookings (Evaluations to book only, per
//          #189); then My sessions today.
import { useState } from "react";
import type { ReactNode } from "react";
import { CalendarClock, CloudOff, MessageCircle, Plane, RotateCw } from "lucide-react";
import { TextLink } from "@/pages/prototype/shell-kit/kit/components/button";
import { EyebrowPill, PageHeader } from "@/pages/prototype/shell-kit/kit/shell/page-header";
import type { NavId } from "@/pages/prototype/shell-kit/kit/shell/nav";
import { Skeleton } from "@/pages/prototype/shell-kit/kit/states/states";
import { cn, HEADING } from "@/pages/prototype/shell-kit/kit/tokens";
import { pluralize } from "@/pages/prototype/shell-kit/kit/format";
import BookingPeek from "@/pages/prototype/home/components/booking-peek";
import BookingTodoDetail from "@/pages/prototype/home/components/booking-todo-detail";
import BookingTodoRow from "@/pages/prototype/home/components/booking-todo-row";
import ChatTodoRow from "@/pages/prototype/home/components/chat-todo-row";
import DeclineDialog from "@/pages/prototype/home/components/decline-dialog";
import MySessionsToday from "@/pages/prototype/home/components/my-sessions-today";
import PrototypeNote from "@/pages/prototype/home/components/prototype-note";
import TimeOffDetail from "@/pages/prototype/home/components/time-off-detail";
import TimeOffTodoRow from "@/pages/prototype/home/components/time-off-todo-row";
import TodayBookings from "@/pages/prototype/home/components/today-bookings";
import TodoCard from "@/pages/prototype/home/components/todo-card";
import type { HomeDataApi } from "@/pages/prototype/home/hooks/use-home-data";
import { useTodoActions } from "@/pages/prototype/home/hooks/use-todo-actions";
import { CURRENT_STAFF, TODAY } from "@/pages/prototype/home/lib/mock-api";
import type { OfficeRole } from "@/pages/prototype/home/lib/mock-api";
import {
  formatDate,
  formatUpdatedAt,
  getGreeting,
  sortBookingsTodo,
  sortChatsByWindow,
} from "@/pages/prototype/home/lib/labels";
import type { BookingTodo, DeskTodo } from "@/pages/prototype/home/lib/labels";
import type {
  AssignableStaff,
  BookingSummary,
  ChildSummary,
  ConversationSummary,
  ExceptionRead,
} from "@/pages/prototype/home/types/api";
import NeedsTutorDetail from "@/pages/prototype/home/components/needs-tutor-detail";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";

const ITEMS_PER_GROUP = 3;

function getSummary(waiting: number, todayCount: number, isManager: boolean): string {
  const noun = isManager ? "session" : "booking";
  const today =
    todayCount === 0
      ? `no ${noun}s today`
      : `${pluralize(todayCount, noun, `${noun}s`)} today`;
  const todo =
    waiting === 0 ? "Nothing in To do" : `${pluralize(waiting, "thing", "things")} in To do`;
  return `${todo}, ${today}.`;
}

type HomeScreenProps = {
  role: OfficeRole;
  api: HomeDataApi;
  // Starts with the first Needs a Tutor Child's details open.
  initialNeedsTutor?: boolean;
  onNavigate: (id: NavId) => void;
  onOpenChat: (chat: ConversationSummary) => void;
  onSeeAllBookings: () => void;
};

export default function HomeScreen({
  role,
  api,
  initialNeedsTutor = false,
  onNavigate,
  onOpenChat,
  onSeeAllBookings,
}: HomeScreenProps): ReactNode {
  const [openBooking, setOpenBooking] = useState<BookingSummary | null>(null);
  const [openTimeOff, setOpenTimeOff] = useState<ExceptionRead | null>(null);
  const [openBookingTodo, setOpenBookingTodo] = useState<DeskTodo | null>(null);
  const [openNeedsTutor, setOpenNeedsTutor] = useState<ChildSummary | null>(() =>
    initialNeedsTutor ? (api.data?.needsTutor.items[0] ?? null) : null,
  );
  const { showToast } = useToast();
  const actions = useTodoActions(api);
  const { phase, data } = api;
  const isManager = role === "manager";
  const user = CURRENT_STAFF[role];
  const chats = sortChatsByWindow(data?.chats.items ?? []);
  const timeOff = data?.timeOff?.items ?? [];
  const bookingTodos = sortBookingsTodo(
    data?.sortOut?.items ?? [],
    data?.evaluations.items ?? [],
    data?.needsTutor.items ?? [],
  );

  function handleOpenBookingTodo(item: BookingTodo): void {
    if (item.kind === "needs-tutor") setOpenNeedsTutor(item.child);
    else setOpenBookingTodo(item);
  }

  function handleAssigned(child: ChildSummary, staff: AssignableStaff[]): void {
    setOpenNeedsTutor(null);
    api.removeNeedsTutor(child.id);
    showToast({
      tone: "success",
      message: `${staff.map((item) => item.name).join(" and ")} assigned. The bot can book ${child.name.split(" ")[0]} again.`,
    });
  }
  const todayItems = data?.today.items ?? [];
  const waitingCount = chats.length + timeOff.length + bookingTodos.length;

  const chatsCard = (
    <TodoCard
      id="chats"
      title="Chats"
      icon={MessageCircle}
      iconClass="bg-(--tl-tint-strong) text-(--tl-primary-ink)"
      phase={phase}
      total={data?.chats.total ?? 0}
      emptyHint="No chat needs attention. The bot has it."
      seeAllLabel="chats that need attention"
      onSeeAll={() => onNavigate("chats")}
      onRetry={api.retry}
    >
      {chats.slice(0, ITEMS_PER_GROUP).map((chat) => (
        <ChatTodoRow
          key={chat.id}
          chat={chat}
          currentUserId={user.id}
          isMarking={actions.busyId === chat.id}
          onOpen={onOpenChat}
          onMarkDone={actions.markDone}
        />
      ))}
    </TodoCard>
  );

  const timeOffCard = (
    <TodoCard
      id="time-off"
      title="Time off"
      icon={Plane}
      iconClass="bg-(--tl-yellow-tint) text-(--tl-yellow-ink)"
      phase={phase}
      total={data?.timeOff?.total ?? 0}
      emptyHint="No time-off requests to review."
      seeAllLabel="pending time-off requests"
      onSeeAll={() => onNavigate("time-off")}
      onRetry={api.retry}
    >
      {timeOff.slice(0, ITEMS_PER_GROUP).map((item) => (
        <TimeOffTodoRow
          key={item.id}
          item={item}
          onOpen={setOpenTimeOff}
        />
      ))}
    </TodoCard>
  );

  const bookingsCard = (
    <TodoCard
      id="bookings"
      title="Bookings"
      icon={CalendarClock}
      iconClass="bg-(--tl-green-tint) text-(--tl-green-ink)"
      phase={phase}
      total={bookingTodos.length}
      emptyHint={
        isManager
          ? "Every Child has an Evaluation booked and an Assigned Tutor."
          : "Every Booking is marked, and every Child has an Evaluation booked and an Assigned Tutor."
      }
      seeAllLabel="bookings to deal with"
      onSeeAll={onSeeAllBookings}
      onRetry={api.retry}
    >
      {bookingTodos.slice(0, ITEMS_PER_GROUP).map((item) => (
        <BookingTodoRow key={item.id} item={item} onOpen={handleOpenBookingTodo} />
      ))}
    </TodoCard>
  );

  const todoHeading = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-3">
      <h2 id="home-todo" className={HEADING}>
        To do
      </h2>
      <FreshnessCue api={api} />
    </div>
  );

  return (
    <>
      <PageHeader
        eyebrow={
          <EyebrowPill>
            {formatDate(TODAY, { weekday: "long", month: "long", day: "numeric" })}
          </EyebrowPill>
        }
        title={`${getGreeting()}, ${user.name.split(" ")[0]}`}
        description={
          phase === "loading" ? (
            <Skeleton className="mt-2 h-4 w-64 max-w-full rounded-full" />
          ) : (
            data && getSummary(waitingCount, todayItems.length, isManager)
          )
        }
      />

      <section aria-labelledby="home-todo">
        {todoHeading}
        <div
          className={cn(
            "grid items-start gap-4 @3xl:grid-cols-2",
            !isManager && "@6xl:grid-cols-3",
          )}
        >
          {chatsCard}
          {bookingsCard}
          {!isManager && timeOffCard}
        </div>
      </section>

      {isManager ? (
        <section aria-labelledby="home-today" className="mt-10">
          <h2 id="home-today" className={cn(HEADING, "pb-3")}>
            My sessions today
          </h2>
          <MySessionsToday
            phase={phase}
            sessions={todayItems}
            onOpen={setOpenBooking}
            onRetry={api.retry}
          />
        </section>
      ) : (
        <>
          <section aria-labelledby="home-today" className="mt-10">
            <div className="flex items-baseline justify-between pb-3">
              <h2 id="home-today" className={HEADING}>
                Today’s bookings
              </h2>
              <TextLink onClick={() => onNavigate("bookings")}>Open Bookings</TextLink>
            </div>
            <TodayBookings
              phase={phase}
              bookings={todayItems}
              onOpen={setOpenBooking}
              onRetry={api.retry}
            />
          </section>
        </>
      )}

      {phase === "ready" && chats.length > 0 && (
        <div className="mt-8 max-w-[640px]">
          <PrototypeNote>
            “Takeover closes in” is estimated from <code>last_message_at</code>.
            The chat list has no <code>last_client_message_at</code> or{" "}
            <code>is_window_open</code>, so the real page needs one of them
            on <code>ConversationSummary</code>.
          </PrototypeNote>
        </div>
      )}

      <BookingPeek
        booking={openBooking}
        isOwnSession={isManager}
        onClose={() => setOpenBooking(null)}
      />
      <BookingTodoDetail
        item={openBookingTodo}
        canKeepClash={!isManager}
        actions={actions}
        onClose={() => setOpenBookingTodo(null)}
      />
      <NeedsTutorDetail
        child={openNeedsTutor}
        onClose={() => setOpenNeedsTutor(null)}
        onAssigned={handleAssigned}
      />
      <TimeOffDetail
        item={openTimeOff}
        backLabel="Home"
        actions={actions}
        onClose={() => setOpenTimeOff(null)}
      />
      <DeclineDialog actions={actions} />
    </>
  );
}

type FreshnessCueProps = { api: HomeDataApi };

// Home refetches on focus and every 60s, with no push (TutorLink#189).
// A quiet "Updated" time says how fresh it is; a failed refresh keeps
// the data and says so instead of blanking the page.
function FreshnessCue({ api }: FreshnessCueProps): ReactNode {
  if (api.phase !== "ready") return null;

  const updated = formatUpdatedAt(api.updatedAt);
  return api.isStale ? (
    <span
      role="status"
      className="inline-flex items-center gap-2 rounded-full bg-(--tl-warning-tint) py-0.5 pr-1 pl-3 text-[13px] font-medium text-(--tl-warning)"
    >
      <CloudOff aria-hidden className="size-3.5" />
      Couldn’t refresh. Showing {updated}.
      <TextLink onClick={api.retry} className="my-0 min-h-8 px-2 text-(--tl-warning)">
        <RotateCw aria-hidden className="size-3.5" />
        Retry
      </TextLink>
    </span>
  ) : (
    <span className="text-[13px] text-(--tl-muted) tabular-nums">
      Updated {updated}
    </span>
  );
}
