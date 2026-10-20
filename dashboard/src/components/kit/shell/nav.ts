// Navigation per role (DESIGN §9; TutorLink#186, revised by Franklin
// 2026-10-13: People split into Families and Staff, Time off top-level
// for the office, Manager's Me folded into their profile). This file is
// the one place nav lives. The sidebar and the phone tab bar hold the
// same items; the tab bar shows 4 and puts the rest under More.
// "profile" is reached from the user card / avatar. Paths are today's
// URLs; each area sets its final one when it is rebuilt.
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

// The app's roles: a Developer gets the Admin nav.
export type NavRole = Role | "developer";

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

export type NavBadge = {
  count: number;
  label: string;
  tone: "pink" | "primary";
};

export type NavItem = {
  id: NavId;
  label: string;
  icon: LucideIcon;
  path: string;
  badge?: NavBadge;
};

const HOME: NavItem = {
  id: "home",
  label: "Home",
  icon: House,
  path: "/home",
};
const BOOKINGS: NavItem = {
  id: "bookings",
  label: "Bookings",
  icon: CalendarDays,
  path: "/bookings",
};
const CHATS: NavItem = {
  id: "chats",
  label: "Chats",
  icon: MessageCircle,
  path: "/chats",
};
const FAMILIES: NavItem = {
  id: "accounts",
  label: "Families",
  icon: BookUser,
  path: "/children",
};
const STAFF: NavItem = {
  id: "staff",
  label: "Staff",
  icon: Users,
  path: "/tutors",
};
const TIME_OFF: NavItem = {
  id: "time-off",
  label: "Time off",
  icon: Plane,
  path: "/time-off",
};
const SETTINGS: NavItem = {
  id: "settings",
  label: "Settings",
  icon: Settings,
  path: "/settings",
};

const TUTOR_NAV: NavItem[] = [
  {
    id: "my-sessions",
    label: "My sessions",
    icon: CalendarDays,
    path: "/sessions",
  },
  {
    id: "my-availability",
    label: "My availability",
    icon: CalendarClock,
    path: "/schedule",
  },
  TIME_OFF,
];

// First path segment → the item it belongs to. Pages without an item of
// their own (Guardians, Users, Reminders) mark their nearest one.
const NAV_ID_BY_SEGMENT: Record<string, NavId> = {
  home: "home",
  dashboard: "home",
  bookings: "bookings",
  chats: "chats",
  reminders: "chats",
  children: "accounts",
  guardians: "accounts",
  tutors: "staff",
  users: "staff",
  settings: "settings",
  sessions: "my-sessions",
  schedule: "my-availability",
  "time-off": "time-off",
  profile: "profile",
};

// Mirrors api/app/schemas/counts.py (GET /api/counts).
export type CountsRead = {
  needs_attention: number;
  time_off_pending: number | null;
  children_awaiting_evaluation: number;
  children_needing_tutor: number;
  bookings_to_sort_out: number;
  unread_chats: number;
};

type NavOptions = {
  // Left out: items without badges; see applyCounts for the rest.
  counts?: CountsRead | null;
  // The office Time off screen comes with area 6; prototypes show it now.
  hasOfficeTimeOff?: boolean;
};

function getOfficeNav(role: NavRole, hasOfficeTimeOff: boolean): NavItem[] {
  const isAdmin = role === "admin" || role === "developer";
  return [
    // No badge on Home (Franklin): Chats and Time off carry their own.
    HOME,
    BOOKINGS,
    CHATS,
    FAMILIES,
    STAFF,
    ...(hasOfficeTimeOff ? [TIME_OFF] : []),
    ...(isAdmin ? [SETTINGS] : []),
  ];
}

function getCountBadge(id: NavId, counts: CountsRead): NavBadge | undefined {
  let badge: NavBadge | undefined;
  if (id === "bookings") {
    badge = {
      count:
        counts.bookings_to_sort_out +
        counts.children_awaiting_evaluation +
        counts.children_needing_tutor,
      label: "to sort out",
      tone: "pink",
    };
  } else if (id === "chats") {
    badge = { count: counts.unread_chats, label: "unread", tone: "primary" };
  } else if (id === "time-off" && counts.time_off_pending !== null) {
    badge = {
      count: counts.time_off_pending,
      label: "to review",
      tone: "pink",
    };
  }
  // A zero shows nothing.
  return badge && badge.count > 0 ? badge : undefined;
}

// Swaps every item's badge for the one the counts give it. `null` means
// the counts are loading or failed, so no item carries a badge.
export function applyCounts(
  items: NavItem[],
  counts: CountsRead | null,
): NavItem[] {
  return items.map((item) => ({
    ...item,
    badge: counts ? getCountBadge(item.id, counts) : undefined,
  }));
}

export function getNav(
  role: NavRole,
  { counts, hasOfficeTimeOff = false }: NavOptions = {},
): NavItem[] {
  const items =
    role === "tutor" ? TUTOR_NAV : getOfficeNav(role, hasOfficeTimeOff);
  return counts === undefined ? items : applyCounts(items, counts);
}

export function getNavIdForPath(path: string): NavId | null {
  // The router matches paths case-insensitively, so this does too.
  const segment = (path.split("/")[1] ?? "").toLowerCase();
  return Object.hasOwn(NAV_ID_BY_SEGMENT, segment)
    ? NAV_ID_BY_SEGMENT[segment]
    : null;
}

export function getLandingNavId(role: NavRole): NavId {
  return role === "tutor" ? "my-sessions" : "home";
}
