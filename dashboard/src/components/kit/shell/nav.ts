// Navigation per role (TutorLink#186, revised by Franklin 2026-10-13:
// People split into Families (Children | Guardians) and Staff, Time off
// top-level for the office, Manager's Me folded into their profile). The sidebar and the
// phone tab bar hold the same items; the tab bar shows 4 and puts the
// rest under More. "profile" is reached from the user card / avatar.
import {
  BookUser,
  CalendarClock,
  CalendarDays,
  House,
  MessageCircle,
  Plane,
  Settings,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Role } from "@/components/kit/types/domain";

export type NavId =
  | "home"
  | "bookings"
  | "chats"
  | "accounts"
  | "staff"
  | "time-off"
  | "settings"
  | "my-sessions"
  | "my-availability"
  | "profile";

export type NavBadge = { count: number; label: string; tone: "pink" | "primary" };

export type NavItem = {
  id: NavId;
  label: string;
  icon: LucideIcon;
  badge?: NavBadge;
};

function getOfficeNav(role: Role): NavItem[] {
  const isAdmin = role === "admin";
  const items: NavItem[] = [
    // No badge on Home (Franklin): Chats and Time off carry their own.
    { id: "home", label: "Home", icon: House },
    { id: "bookings", label: "Bookings", icon: CalendarDays },
    { id: "chats", label: "Chats", icon: MessageCircle },
    { id: "accounts", label: "Families", icon: BookUser },
    { id: "staff", label: "Staff", icon: Users },
    { id: "time-off", label: "Time off", icon: Plane },
  ];
  return isAdmin
    ? [...items, { id: "settings", label: "Settings", icon: Settings }]
    : items;
}

const TUTOR_NAV: NavItem[] = [
  { id: "my-sessions", label: "My sessions", icon: CalendarDays },
  { id: "my-availability", label: "My availability", icon: CalendarClock },
  { id: "time-off", label: "Time off", icon: Plane },
];

// Mirrors api/app/schemas/counts.py (GET /api/counts).
export type CountsRead = {
  needs_attention: number;
  time_off_pending: number | null;
  children_awaiting_evaluation: number;
  bookings_to_sort_out: number;
  unread_chats: number;
};

function getCountBadge(id: NavId, counts: CountsRead): NavBadge | undefined {
  let badge: NavBadge | undefined;
  if (id === "bookings") {
    badge = {
      count: counts.bookings_to_sort_out + counts.children_awaiting_evaluation,
      label: "to sort out",
      tone: "pink",
    };
  } else if (id === "chats") {
    badge = { count: counts.unread_chats, label: "unread", tone: "primary" };
  } else if (id === "time-off" && counts.time_off_pending !== null) {
    badge = { count: counts.time_off_pending, label: "to review", tone: "pink" };
  }
  return badge;
}

// Swaps every item's badge for the one the counts give it. `null` means
// the counts are still loading, so no item carries a badge.
export function applyCounts(
  items: NavItem[],
  counts: CountsRead | null,
): NavItem[] {
  return items.map((item) => ({
    ...item,
    badge: counts ? getCountBadge(item.id, counts) : undefined,
  }));
}

// `counts` left out: items without badges; see applyCounts for the rest.
export function getNav(role: Role, counts?: CountsRead | null): NavItem[] {
  const items = role === "tutor" ? TUTOR_NAV : getOfficeNav(role);
  return counts === undefined ? items : applyCounts(items, counts);
}

export function getLandingNavId(role: Role): NavId {
  return role === "tutor" ? "my-sessions" : "home";
}
