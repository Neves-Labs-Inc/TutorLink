// Navigation per role (TutorLink#186, revised by Franklin 2026-10-13:
// People split into Accounts (Children | Guardians) and Staff, Time off
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
import {
  CHATS_UNREAD,
  getBookingAttentionFor,
  PENDING_TIME_OFF,
} from "@/pages/prototype/shell-kit/kit/mock-data";
import type { Role } from "@/pages/prototype/shell-kit/kit/mock-data";

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
    {
      id: "bookings",
      label: "Bookings",
      icon: CalendarDays,
      badge: {
        count: getBookingAttentionFor(role).length,
        label: "need attention",
        tone: "pink",
      },
    },
    {
      id: "chats",
      label: "Chats",
      icon: MessageCircle,
      badge: { count: CHATS_UNREAD, label: "unread", tone: "primary" },
    },
    { id: "accounts", label: "Accounts", icon: BookUser },
    { id: "staff", label: "Staff", icon: Users },
    {
      id: "time-off",
      label: "Time off",
      icon: Plane,
      // Only Admins decide time off, so only they get the pending count.
      badge: isAdmin
        ? { count: PENDING_TIME_OFF.length, label: "to review", tone: "pink" }
        : undefined,
    },
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

export function getNav(role: Role): NavItem[] {
  return role === "tutor" ? TUTOR_NAV : getOfficeNav(role);
}

export function getLandingNavId(role: Role): NavId {
  return role === "tutor" ? "my-sessions" : "home";
}
