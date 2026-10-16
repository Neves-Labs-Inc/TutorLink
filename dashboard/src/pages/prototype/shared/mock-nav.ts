// The kit nav with the badges the mock data gives it, for prototypes that
// load no counts of their own. Tutors get no badges.
import { getNav } from "@/components/kit/shell/nav";
import type { NavBadge, NavId, NavItem } from "@/components/kit/shell/nav";
import type { Role } from "@/components/kit/types/domain";
import {
  CHATS_UNREAD,
  getBookingAttentionFor,
  PENDING_TIME_OFF,
} from "@/pages/prototype/shared/mock-data";

function getMockBadge(role: Role, id: NavId): NavBadge | undefined {
  if (role === "tutor") return undefined;

  let badge: NavBadge | undefined;
  if (id === "bookings") {
    badge = {
      count: getBookingAttentionFor(role).length,
      label: "need attention",
      tone: "pink",
    };
  } else if (id === "chats") {
    badge = { count: CHATS_UNREAD, label: "unread", tone: "primary" };
  } else if (id === "time-off" && role === "admin") {
    // Only Admins decide time off, so only they get the pending count.
    badge = { count: PENDING_TIME_OFF.length, label: "to review", tone: "pink" };
  }
  return badge;
}

export function getMockNav(role: Role): NavItem[] {
  return getNav(role).map((item) => ({ ...item, badge: getMockBadge(role, item.id) }));
}
