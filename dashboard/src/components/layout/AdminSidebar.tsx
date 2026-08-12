import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  BookOpen,
  CalendarDays,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  UserCog,
  Users,
  X,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import { useUiStore } from '@/stores/uiStore'

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/tutors', label: 'Tutors', icon: GraduationCap },
  { to: '/clients', label: 'Clients', icon: Users },
  { to: '/bookings', label: 'Bookings', icon: CalendarDays },
  { to: '/subjects', label: 'Subjects', icon: BookOpen },
  { to: '/users', label: 'Users', icon: UserCog },
] as const

const linkClasses = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
    'outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar',
    isActive
      ? 'bg-sidebar-primary text-sidebar-primary-foreground'
      : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
  )

function Brand() {
  return (
    <span className="font-heading text-base font-semibold tracking-tight text-sidebar-foreground">
      TutorLink
    </span>
  )
}

function NavBody({ onNavigate }: { onNavigate?: () => void }) {
  const { logout } = useAuth()
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  const handleLogout = () => {
    setIsLoggingOut(true)
    onNavigate?.()
    logout()
  }

  return (
    <>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Admin">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={linkClasses} onClick={onNavigate}>
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
    </>
  )
}

export function AdminSidebar() {
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen)
  const toggleMobileNav = useUiStore((state) => state.toggleMobileNav)
  const closeMobileNav = useUiStore((state) => state.closeMobileNav)

  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!mobileNavOpen) return

    const panel = panelRef.current
    const trigger = triggerRef.current
    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [],
      )

    focusables()[0]?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMobileNav()
        return
      }
      if (event.key !== 'Tab') return

      const items = focusables()
      if (items.length === 0) return

      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null

      if (event.shiftKey && (active === first || !panel?.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !panel?.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      trigger?.focus()
    }
  }, [mobileNavOpen, closeMobileNav])

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 w-full items-center gap-3 border-b border-sidebar-border bg-sidebar px-4 md:hidden">
        <button
          ref={triggerRef}
          type="button"
          onClick={toggleMobileNav}
          aria-label="Open navigation menu"
          aria-expanded={mobileNavOpen}
          className="-ml-2 inline-flex size-10 items-center justify-center rounded-lg text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Menu aria-hidden="true" className="size-5" />
        </button>
        <Brand />
      </header>

      <aside className="hidden border-r border-sidebar-border bg-sidebar md:sticky md:top-0 md:flex md:h-dvh md:w-64 md:shrink-0 md:flex-col">
        <div className="flex h-14 items-center border-b border-sidebar-border px-6">
          <Brand />
        </div>
        <NavBody />
      </aside>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-foreground/60"
            onClick={closeMobileNav}
            aria-hidden="true"
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 flex w-[17rem] max-w-[85%] flex-col border-r border-sidebar-border bg-sidebar shadow-xl"
          >
            <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
              <Brand />
              <button
                type="button"
                onClick={closeMobileNav}
                aria-label="Close navigation menu"
                className="-mr-2 inline-flex size-10 items-center justify-center rounded-lg text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>
            <NavBody onNavigate={closeMobileNav} />
          </div>
        </div>
      )}
    </>
  )
}
