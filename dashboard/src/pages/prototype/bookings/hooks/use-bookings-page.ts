// Everything the Bookings page holds: the view, week and filters (which
// become the list query), what's open (detail, form, Child), the fake
// load cycle, and the acts with their toasts.
import { useState } from "react";
import { useFilters } from "@/components/kit/hooks/use-filters";
import { useToast } from "@/components/kit/overlays/use-toast";
import type { AccountEntry } from "@/pages/prototype/shared/account-details";
import { useBookingStore } from "@/pages/prototype/bookings/hooks/use-booking-store";
import type { BookingStore } from "@/pages/prototype/bookings/hooks/use-booking-store";
import type { FormStart } from "@/pages/prototype/bookings/hooks/use-booking-form";
import {
  CURRENT_STAFF_ID,
  KIT_CHILD_ID,
  TODAY,
  WEEK_START,
} from "@/pages/prototype/bookings/lib/mock-data";
import {
  addDays,
  formatShortDay,
  formatTime,
  getWeekStart,
} from "@/pages/prototype/bookings/lib/format";
import {
  EMPTY_QUERY,
  getEvaluableChildren,
  listBookings,
} from "@/pages/prototype/bookings/lib/rules";
import type { BookingQuery } from "@/pages/prototype/bookings/lib/rules";
import type {
  BookingCreate,
  BookingDetail,
  BookingKind,
  BookingStatus,
  BookingSummary,
  ChildSummary,
} from "@/pages/prototype/bookings/lib/wire";

const FAKE_LOAD_MS = 1200;
const DAYS_PER_WEEK = 7;

export type OfficeRole = "admin" | "manager";
export type DataState = "ready" | "loading" | "error" | "empty";
export type View = "list" | "calendar";
export type Scale = "week" | "day";
export type Screen =
  | "list"
  | "calendar"
  | "day"
  | "needs-attention"
  | "detail"
  | "new"
  | "new-eval"
  | "change"
  | "cancel"
  | "new-assigned"
  | "new-not-assigned"
  | "new-no-tutors";

type FormOpen = { start: FormStart; editingId: string | null };

type FilterKey = "kind" | "staff" | "status";

// A Booking the "detail", "change" and "cancel" screens open on.
const CLASH_BOOKING_ID = "bk-33";
const UPCOMING_BOOKING_ID = "bk-43";
const WAITING_CHILD_ID = "child-c4";
const SOFIA_ID = "child-c1";

function getNewStart(kind: BookingKind, childId: string | null): FormStart {
  return { kind, childId, date: addDays(TODAY, 1), time: null, userId: null };
}

function getInitialForm(screen: Screen): FormOpen | null {
  if (screen === "new") return { start: getNewStart("regular", null), editingId: null };
  if (screen === "new-eval") {
    return { start: getNewStart("evaluation", WAITING_CHILD_ID), editingId: null };
  }
  // Assigned Tutors (TutorLink#243): Sofia (Ana and Marco assigned),
  // Sofia with Priya picked, and Valentina, who has none.
  if (screen === "new-assigned") {
    return { start: getNewStart("regular", SOFIA_ID), editingId: null };
  }
  if (screen === "new-not-assigned") {
    return { start: { ...getNewStart("regular", SOFIA_ID), userId: "user-priya" }, editingId: null };
  }
  if (screen === "new-no-tutors") {
    return { start: getNewStart("regular", "child-c12"), editingId: null };
  }
  if (screen === "change") {
    return { start: getNewStart("regular", null), editingId: CLASH_BOOKING_ID };
  }
  return null;
}

function getInitialOpenId(screen: Screen): string | null {
  if (screen === "detail") return CLASH_BOOKING_ID;
  if (screen === "cancel") return UPCOMING_BOOKING_ID;
  return null;
}

function getInitialView(screen: Screen): View {
  if (screen === "calendar" || screen === "day") return "calendar";
  return "list";
}

export function useBookingsPage(role: OfficeRole, screen: Screen, initialState: DataState) {
  const store: BookingStore = useBookingStore();
  const { showToast } = useToast();
  const callerId = CURRENT_STAFF_ID[role];

  const [dataState, setDataState] = useState<DataState>(initialState);
  const [isRetrying, setIsRetrying] = useState(false);
  const [view, setView] = useState<View>(getInitialView(screen));
  const [scale, setScale] = useState<Scale>(screen === "day" ? "day" : "week");
  const [weekStart, setWeekStart] = useState(WEEK_START);
  const [day, setDay] = useState(TODAY);
  const [search, setSearch] = useState("");
  const [isMineOnly, setIsMineOnly] = useState(false);
  // Where Home's To do "See all" for Bookings lands (placeholder).
  const [isAttentionOnly, setIsAttentionOnly] = useState(screen === "needs-attention");
  const filters = useFilters<FilterKey>({ kind: [], staff: [], status: [] });
  const [openId, setOpenId] = useState<string | null>(getInitialOpenId(screen));
  const [isCancelOnOpen, setIsCancelOnOpen] = useState(screen === "cancel");
  const [form, setForm] = useState<FormOpen | null>(getInitialForm(screen));
  const [accountStack, setAccountStack] = useState<AccountEntry[]>([]);

  const isEmpty = dataState === "empty";
  const all = isEmpty ? [] : store.bookings;

  const query: BookingQuery = {
    ...EMPTY_QUERY,
    // Needs attention spans every date in the list; the calendar keeps
    // its week.
    from: isAttentionOnly && view === "list" ? null : weekStart,
    to: isAttentionOnly && view === "list" ? null : addDays(weekStart, DAYS_PER_WEEK - 1),
    isToSortOut: isAttentionOnly,
    q: search,
    // Kind/Status values are wire values already.
    kinds: filters.selected.kind as BookingKind[],
    statuses: filters.selected.status as BookingStatus[],
    userIds: isMineOnly ? [callerId] : filters.selected.staff,
  };
  const page = listBookings(all, query, callerId, role);
  // GET /api/children?evaluable=true; with the to-sort-out total it is
  // the Bookings nav badge (CountsRead: bookings_to_sort_out +
  // children_awaiting_evaluation).
  const evaluations = isEmpty ? [] : getEvaluableChildren(store.bookings);
  const toSortOutTotal = listBookings(
    all,
    { ...EMPTY_QUERY, isToSortOut: true },
    callerId,
    role,
  ).total;
  const badgeCount = toSortOutTotal + evaluations.length;

  function retry(): void {
    setIsRetrying(true);
    window.setTimeout(() => {
      setIsRetrying(false);
      setDataState("loading");
      window.setTimeout(() => setDataState("ready"), FAKE_LOAD_MS);
    }, FAKE_LOAD_MS / 2);
  }

  function clearFilters(): void {
    setSearch("");
    filters.clearAll();
    setIsMineOnly(false);
    setIsAttentionOnly(false);
  }

  function moveWeek(weeks: number): void {
    const next = addDays(weekStart, weeks * DAYS_PER_WEEK);
    setWeekStart(next);
    setDay(next <= TODAY && TODAY <= addDays(next, DAYS_PER_WEEK - 1) ? TODAY : next);
  }

  function goToToday(): void {
    setWeekStart(WEEK_START);
    setDay(TODAY);
  }

  function openBooking(booking: { id: string }): void {
    setIsCancelOnOpen(false);
    setOpenId(booking.id);
  }

  function openNew(start: Partial<FormStart> = {}): void {
    setOpenId(null);
    setForm({ start: { ...getNewStart("regular", null), ...start }, editingId: null });
  }

  function openChange(booking: { id: string }): void {
    setOpenId(null);
    setForm({ start: getNewStart("regular", null), editingId: booking.id });
  }

  function openCancel(booking: { id: string }): void {
    setIsCancelOnOpen(true);
    setOpenId(booking.id);
  }

  function openChat(guardianName: string): void {
    showToast({ tone: "info", message: `Opens the chat with ${guardianName} (Chats prototype).` });
  }

  function openChild(childId: string): void {
    const kitId = KIT_CHILD_ID[childId];
    if (kitId) {
      setAccountStack([{ kind: "child", id: kitId }]);
    } else {
      showToast({ tone: "info", message: "Opens the Child (Families prototype)." });
    }
  }

  function describe(booking: BookingSummary | BookingDetail): string {
    return `${booking.child.name}, ${formatShortDay(booking.scheduled_date)} ${formatTime(booking.start_time)}`;
  }

  function setStatusWithUndo(booking: BookingSummary | BookingDetail, status: BookingStatus, message: string): void {
    const previous = booking.status;
    store.setStatus(booking.id, status);
    showToast({
      tone: "success",
      message,
      actionLabel: "Undo",
      onAction: () => store.setStatus(booking.id, previous),
    });
  }

  function complete(booking: BookingSummary | BookingDetail): void {
    setStatusWithUndo(booking, "completed", `Marked Completed: ${describe(booking)}.`);
  }

  function didntHappen(booking: BookingSummary | BookingDetail): void {
    setStatusWithUndo(booking, "cancelled", `Cancelled, didn’t happen: ${describe(booking)}.`);
  }

  function keep(booking: BookingSummary | BookingDetail): void {
    store.acknowledgeClash(booking.id, { id: callerId, name: "Maria Lopez" });
    showToast({
      tone: "success",
      message: `Kept over Time off: ${describe(booking)}.`,
      actionLabel: "Undo",
      onAction: () => store.withdrawAcknowledgement(booking.id),
    });
  }

  function undoKeep(booking: BookingDetail): void {
    store.withdrawAcknowledgement(booking.id);
    showToast({ tone: "info", message: "No longer kept: the Time off clash needs attention again." });
  }

  function cancelled(booking: BookingDetail): void {
    store.setStatus(booking.id, "cancelled");
    setOpenId(null);
    const guardian = booking.booked_by_guardian?.name ?? booking.guardians[0]?.name ?? "the Guardian";
    showToast({
      tone: "success",
      message: `Booking cancelled. Let ${guardian} know.`,
      actionLabel: "Open chat",
      onAction: () => openChat(guardian),
    });
  }

  function saved(body: BookingCreate): void {
    const editingId = form?.editingId ?? null;
    setForm(null);
    const result = editingId ? store.replace(editingId, body) : store.create(body);
    setWeekStart(getWeekStart(result.scheduled_date));
    setDay(result.scheduled_date);
    const guardian = result.booked_by_guardian?.name ?? result.guardians[0]?.name ?? "the Guardian";
    if (editingId) {
      setOpenId(result.id);
      showToast({
        tone: "success",
        message: `Booking changed. Let ${guardian} know.`,
        actionLabel: "Open chat",
        onAction: () => openChat(guardian),
      });
    } else {
      showToast({
        tone: "success",
        message: `Booked ${result.child.name} with ${result.staff.name}, ${formatShortDay(result.scheduled_date)} at ${formatTime(result.start_time)}.`,
        actionLabel: "Open",
        onAction: () => openBooking(result),
      });
    }
  }

  function bookEvaluation(child: ChildSummary): void {
    openNew({ kind: "evaluation", childId: child.id });
  }

  return {
    role,
    callerId,
    store,
    dataState,
    isRetrying,
    retry,
    view,
    setView,
    scale,
    setScale,
    weekStart,
    day,
    setDay,
    moveWeek,
    goToToday,
    search,
    setSearch,
    isMineOnly,
    setIsMineOnly,
    filters,
    clearFilters,
    query,
    page,
    isAttentionOnly,
    evaluations,
    badgeCount,
    setIsAttentionOnly,
    openId,
    isCancelOnOpen,
    openBooking,
    closeBooking: () => setOpenId(null),
    form,
    openNew,
    openChange,
    openCancel,
    // Discarding Change booking goes back to the Booking it came from.
    closeForm: () => {
      setOpenId(form?.editingId ?? null);
      setForm(null);
    },
    accountStack,
    setAccountStack,
    openChat,
    openChild,
    complete,
    didntHappen,
    keep,
    undoKeep,
    cancelled,
    saved,
    bookEvaluation,
  };
}

export type BookingsPageState = ReturnType<typeof useBookingsPage>;
