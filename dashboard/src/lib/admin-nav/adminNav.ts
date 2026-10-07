import {
  Baby,
  BellRing,
  CalendarDays,
  GraduationCap,
  LayoutDashboard,
  MessageSquare,
  Settings,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { ADMIN_ROLES, STAFF_ROLES, type Role } from '@/lib/auth/auth'

export type AdminNavItem = {
  to: string
  label: string
  icon: LucideIcon
  allow: readonly Role[]
}

// Mirrors the RouteGuard `allow` lists in App.tsx, so a link never leads to a redirect.
const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, allow: STAFF_ROLES },
  { to: '/tutors', label: 'Tutors', icon: GraduationCap, allow: STAFF_ROLES },
  { to: '/children', label: 'Children', icon: Baby, allow: STAFF_ROLES },
  { to: '/guardians', label: 'Guardians', icon: Users, allow: STAFF_ROLES },
  { to: '/chats', label: 'Chats', icon: MessageSquare, allow: STAFF_ROLES },
  { to: '/bookings', label: 'Bookings', icon: CalendarDays, allow: STAFF_ROLES },
  { to: '/reminders', label: 'Reminders', icon: BellRing, allow: STAFF_ROLES },
  { to: '/users', label: 'Users', icon: UserCog, allow: ADMIN_ROLES },
  { to: '/settings', label: 'Settings', icon: Settings, allow: ADMIN_ROLES },
]

export const adminNavItemsFor = (role: Role): AdminNavItem[] =>
  ADMIN_NAV_ITEMS.filter((item) => item.allow.includes(role))
