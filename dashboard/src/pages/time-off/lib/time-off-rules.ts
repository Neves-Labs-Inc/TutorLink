// Time off rules (CONTEXT.md, Time off): which list an item sits in and
// who may act on it. The API is the authority; these only decide what
// the screens show. Business time is naive New York wall-clock strings,
// so "ended" is plain string order. `now` defaults to the real clock.
import { BUSINESS_TIME_ZONE } from "@/components/kit/format";
import type { TimeOffStatus as TimeOffBadgeStatus } from "@/components/kit/types/domain";
import { ADMIN_ROLES } from "@/lib/auth/auth";
import type { Role } from "@/lib/auth/auth";
import type { ExceptionRead, TimeOffStatus } from "@/lib/queries/time-off";

export type Viewer = { id: string; role: Role };

export type QueueTab = "pending" | "upcoming" | "declined-cancelled" | "past";

export type OwnSection = "waiting" | "coming" | "declined-cancelled" | "history";

type Window = Pick<
  ExceptionRead,
  "start_date" | "end_date" | "start_time" | "end_time"
>;

const BADGE_STATUS: Record<TimeOffStatus, TimeOffBadgeStatus> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
};

// "2031-10-20T15:10:00", the business's wall clock at `at`.
export function getBusinessNow(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
}

// All-day: over once its last day is. Part-day: at the end time on the
// last day.
export function hasEnded(window: Window, now: string = getBusinessNow()): boolean {
  return window.end_time === null
    ? window.end_date < now.slice(0, 10)
    : `${window.end_date}T${window.end_time}` <= now;
}

// Where a decided or cancelled item stops being news.
function isClosedButLive(item: ExceptionRead, now: string): boolean {
  return (
    (item.status === "rejected" || item.status === "cancelled") &&
    !hasEnded(item, now)
  );
}

// The Admin queue's tab. Expired is always Past.
export function getQueueTab(
  item: ExceptionRead,
  now: string = getBusinessNow(),
): QueueTab {
  let tab: QueueTab = "past";
  if (item.status === "pending") {
    tab = "pending";
  } else if (item.status === "approved" && !hasEnded(item, now)) {
    tab = "upcoming";
  } else if (isClosedButLive(item, now)) {
    tab = "declined-cancelled";
  }
  return tab;
}

// The section of a Tutor's or Manager's own list.
export function getOwnSection(
  item: ExceptionRead,
  now: string = getBusinessNow(),
): OwnSection {
  const sections: Record<QueueTab, OwnSection> = {
    pending: "waiting",
    upcoming: "coming",
    "declined-cancelled": "declined-cancelled",
    past: "history",
  };
  return sections[getQueueTab(item, now)];
}

export function isAdminViewer(viewer: Viewer): boolean {
  return ADMIN_ROLES.includes(viewer.role);
}

// Admins only (the caller checks the role). A declined request can still
// be approved while it hasn't ended.
export function canApprove(
  item: ExceptionRead,
  now: string = getBusinessNow(),
): boolean {
  return (
    item.status === "pending" ||
    (item.status === "rejected" && !hasEnded(item, now))
  );
}

// Admins only (the caller checks the role).
export function canDecline(item: ExceptionRead): boolean {
  return item.status === "pending";
}

// The owner cancels their own pending or approved Time off; an Admin
// cancels anyone's approved Time off, but decides (never cancels) someone
// else's pending request.
export function canCancel(
  item: ExceptionRead,
  viewer: Viewer,
  now: string = getBusinessNow(),
): boolean {
  if (hasEnded(item, now)) return false;

  const isOwn = item.staff.id === viewer.id;
  const isOwnLive = isOwn && (item.status === "pending" || item.status === "approved");
  const isAdminCancel = isAdminViewer(viewer) && item.status === "approved";
  return isOwnLive || isAdminCancel;
}

// The kit badge's word for a wire status.
export function getTimeOffBadgeStatus(status: TimeOffStatus): TimeOffBadgeStatus {
  return BADGE_STATUS[status];
}
