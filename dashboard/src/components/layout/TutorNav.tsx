import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { CalendarDays, CalendarOff, ClipboardList, LogOut } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'

const NAV_ITEMS = [
  { to: '/schedule', label: 'My Schedule', icon: CalendarDays },
  { to: '/sessions', label: 'My Sessions', icon: ClipboardList },
  { to: '/time-off', label: 'Time Off', icon: CalendarOff },
] as const

const sidebarLinkClasses = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
    'outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar',
    isActive
      ? 'bg-sidebar-primary text-sidebar-primary-foreground'
      : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
  )

const tabLinkClasses = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-xs font-medium transition-colors',
    'outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
    isActive
      ? 'bg-sidebar-primary text-sidebar-primary-foreground'
      : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
  )

export function TutorNav() {
  const { logout } = useAuth()
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  const handleLogout = () => {
    setIsLoggingOut(true)
    logout()
  }

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 w-full items-center justify-between border-b border-sidebar-border bg-sidebar px-4 md:hidden">
        <span className="font-heading text-base font-semibold tracking-tight text-sidebar-foreground">
          TutorLink
        </span>
        <button
          type="button"
          onClick={handleLogout}
          disabled={isLoggingOut}
          aria-label="Log out"
          className="-mr-2 inline-flex size-10 items-center justify-center rounded-lg text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <LogOut aria-hidden="true" className="size-5" />
        </button>
      </header>

      <aside className="hidden border-r border-sidebar-border bg-sidebar md:sticky md:top-0 md:flex md:h-dvh md:w-56 md:shrink-0 md:flex-col">
        <div className="flex h-14 items-center border-b border-sidebar-border px-6">
          <span className="font-heading text-base font-semibold tracking-tight text-sidebar-foreground">
            TutorLink
          </span>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Tutor">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={sidebarLinkClasses}>
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              <span className="truncate">{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-sidebar-border px-3 py-3">
          <button
            type="button"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              'outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar',
            )}
          >
            <LogOut aria-hidden="true" className="size-4 shrink-0" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      <nav
        aria-label="Tutor"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-sidebar-border bg-sidebar pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <div className="flex items-stretch gap-1 px-2 py-1.5">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={tabLinkClasses}>
              <Icon aria-hidden="true" className="size-5 shrink-0" />
              <span className="truncate">{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  )
}
