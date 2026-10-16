// The Office Bookings page inside the shell: header and toolbar, then
// List or Calendar for the chosen week. Details, the booking form and
// Child details open over it.
import type { ReactNode } from "react";
import { CalendarPlus, CalendarSearch, CircleCheckBig } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import {
  EmptyState,
  ErrorState,
  Skeleton,
  TableSkeleton,
} from "@/components/kit/states/states";
import { CARD, cn } from "@/components/kit/tokens";
import AccountDetails from "@/pages/prototype/shared/account-details";
import BookingDetailPanel from "@/pages/prototype/bookings/components/booking-detail-panel";
import BookingForm from "@/pages/prototype/bookings/components/booking-form";
import BookingsHeader from "@/pages/prototype/bookings/components/bookings-header";
import BookingsList from "@/pages/prototype/bookings/components/bookings-list";
import BookingsShell from "@/pages/prototype/bookings/components/bookings-shell";
import CalendarView from "@/pages/prototype/bookings/components/calendar-view";
import EvaluationsToBook from "@/pages/prototype/bookings/components/evaluations-to-book";
import WireNote from "@/pages/prototype/bookings/components/wire-note";
import { useBookingsPage } from "@/pages/prototype/bookings/hooks/use-bookings-page";
import type {
  BookingsPageState,
  DataState,
  OfficeRole,
  Screen,
} from "@/pages/prototype/bookings/hooks/use-bookings-page";

function CalendarSkeleton(): ReactNode {
  return (
    <div role="status" aria-label="Loading the calendar" className={cn(CARD, "flex flex-col gap-3 p-4")}>
      <Skeleton className="h-10 w-full rounded-[14px]" />
      <Skeleton className="h-[420px] w-full rounded-[14px]" />
    </div>
  );
}

function renderWeek(state: BookingsPageState): ReactNode {
  if (state.dataState === "loading") {
    return state.view === "calendar" ? (
      <CalendarSkeleton />
    ) : (
      <TableSkeleton label="Loading bookings" rows={6} />
    );
  }
  if (state.dataState === "error") {
    return (
      <ErrorState
        title="Bookings didn’t load"
        body="Something went wrong on our side. Your bookings are safe; try again in a moment."
        onRetry={state.retry}
        isRetrying={state.isRetrying}
      />
    );
  }
  const isFiltered = state.search.trim() !== "" || state.filters.activeCount > 0 || state.isMineOnly;
  if (state.view === "list" && state.isAttentionOnly && !isFiltered) {
    const hasBookings = state.page.items.length > 0;
    if (!hasBookings && state.evaluations.length === 0) {
      return (
        <EmptyState
          icon={CircleCheckBig}
          tone="green"
          title="Nothing needs attention"
          body="Every past booking is marked, none clashes with Time off, and every new Child has an Evaluation booked."
          action={<Button onClick={() => state.setIsAttentionOnly(false)}>Show all bookings</Button>}
        />
      );
    }
    return (
      <>
        <EvaluationsToBook
          waiting={state.evaluations}
          onOpenChild={(child) => state.openChild(child.id)}
          onBook={state.bookEvaluation}
        />
        {hasBookings && (
          <BookingsList
            key="attention"
            rows={state.page.items}
            onOpen={state.openBooking}
            foldsEarlier={false}
          />
        )}
      </>
    );
  }
  if (state.view === "list" && state.page.items.length === 0) {
    return isFiltered ? (
      <EmptyState
        icon={CalendarSearch}
        title="No bookings match"
        body="Try another name, or clear the filters to see the whole week."
        action={<Button onClick={state.clearFilters}>Clear search and filters</Button>}
      />
    ) : (
      <EmptyState
        icon={CalendarPlus}
        title="Nothing booked this week"
        body="Bookings the bot or the office make show up here, by day."
        action={
          <Button variant="primary" icon={CalendarPlus} onClick={() => state.openNew()}>
            New booking
          </Button>
        }
      />
    );
  }
  if (state.view === "calendar") {
    return (
      <CalendarView
        rows={state.page.items}
        weekStart={state.weekStart}
        scale={state.scale}
        day={state.day}
        onDayChange={state.setDay}
        onOpen={state.openBooking}
        onCreateAt={(at) => state.openNew({ date: at.date, time: at.time, userId: at.userId })}
      />
    );
  }
  return (
    <BookingsList
      key={`${state.weekStart}-${state.isAttentionOnly}`}
      rows={state.page.items}
      onOpen={state.openBooking}
      foldsEarlier={!state.isAttentionOnly}
    />
  );
}

type BookingsPageProps = {
  role: OfficeRole;
  screen: Screen;
  dataState: DataState;
};

export default function BookingsPage({ role, screen, dataState }: BookingsPageProps): ReactNode {
  const state = useBookingsPage(role, screen, dataState);
  const openBooking = state.openId ? state.store.getBooking(state.openId) : null;
  const editing = state.form?.editingId ? state.store.getBooking(state.form.editingId) : null;

  return (
    <BookingsShell
      role={role}
      badgeCount={state.dataState === "ready" ? state.badgeCount : 0}
      onOpenBookings={() => state.setView("list")}
    >
      <BookingsHeader state={state} />
      {renderWeek(state)}
      <WireNote state={state} />

      <BookingDetailPanel
        key={`${state.openId}-${state.isCancelOnOpen}`}
        booking={openBooking}
        role={role}
        onClose={state.closeBooking}
        isCancelConfirmOpen={state.isCancelOnOpen}
        actions={{
          onChange: state.openChange,
          onCancelled: state.cancelled,
          onComplete: state.complete,
          onDidntHappen: state.didntHappen,
          onKeep: state.keep,
          onUndoKeep: state.undoKeep,
          onOpenChild: (booking) => state.openChild(booking.child.id),
          onOpenChat: state.openChat,
        }}
      />
      {state.form && (
        <BookingForm
          key={JSON.stringify(state.form)}
          start={state.form.start}
          editing={editing}
          bookings={state.store.bookings}
          onClose={state.closeForm}
          onSaved={state.saved}
        />
      )}
      <AccountDetails
        stack={state.accountStack}
        onChange={state.setAccountStack}
        rootLabel="Bookings"
      />
    </BookingsShell>
  );
}
