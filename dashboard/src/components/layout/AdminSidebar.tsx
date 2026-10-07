import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { LogOut, Menu, UserRound, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import { adminNavItemsFor } from '@/lib/admin-nav/adminNav'
import { useAuthStore } from '@/stores/authStore'
import { useUiStore } from '@/stores/uiStore'
import { MyProfileDialog } from './MyProfileDialog'

type NavBodyProps = {
  onNavigate?: () => void
  onOpenProfile: () => void
}

const linkClasses = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
    'outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar',
    isActive
      ? 'bg-sidebar-primary text-sidebar-primary-foreground'
      : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
  )

const footerButtonClasses = cn(
  'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors md:min-h-0',
  'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent/80',
  'outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar',
)

const iconButtonClasses =
  'inline-flex size-10 items-center justify-center rounded-lg text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none'

export const AdminSidebar = () => {
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen)
  const toggleMobileNav = useUiStore((state) => state.toggleMobileNav)
  const closeMobileNav = useUiStore((state) => state.closeMobileNav)
  const [isProfileOpen, setIsProfileOpen] = useState(false)

  const openProfile = () => setIsProfileOpen(true)

  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let cleanup: (() => void) | undefined

    if (mobileNavOpen) {
      const panel = panelRef.current
      const trigger = triggerRef.current
      const focusables = () =>
        Array.from(panel?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [])

      focusables()[0]?.focus()

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          closeMobileNav()
        } else if (event.key === 'Tab') {
          const items = focusables()

          if (items.length > 0) {
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
        }
      }

      const previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      document.addEventListener('keydown', onKeyDown)

      cleanup = () => {
        document.removeEventListener('keydown', onKeyDown)
        document.body.style.overflow = previousOverflow
        trigger?.focus()
      }
    }

    return cleanup
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
          className={cn('-ml-2', iconButtonClasses)}
        >
          <Menu aria-hidden="true" className="size-5" />
        </button>
        <Brand />
      </header>

      <aside className="hidden border-r border-sidebar-border bg-sidebar md:sticky md:top-0 md:flex md:h-dvh md:w-64 md:shrink-0 md:flex-col">
        <div className="flex h-14 items-center border-b border-sidebar-border px-6">
          <Brand />
        </div>
        <NavBody onOpenProfile={openProfile} />
      </aside>

      <div
        className={cn(
          'fixed inset-0 z-40 overflow-hidden transition-[visibility] duration-200 md:hidden',
          mobileNavOpen ? 'visible' : 'invisible',
        )}
      >
        <div
          className={cn(
            'absolute inset-0 bg-foreground/60 transition-opacity duration-200 ease-out motion-reduce:transition-none',
            mobileNavOpen ? 'opacity-100' : 'opacity-0',
          )}
          onClick={closeMobileNav}
          aria-hidden="true"
        />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
          className={cn(
            'absolute inset-y-0 left-0 flex w-68 max-w-[85%] flex-col border-r border-sidebar-border bg-sidebar shadow-xl',
            'transition-transform duration-200 ease-out motion-reduce:transition-none',
            mobileNavOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
            <Brand />
            <button
              type="button"
              onClick={closeMobileNav}
              aria-label="Close navigation menu"
              className={cn('-mr-2', iconButtonClasses)}
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>
          <NavBody onNavigate={closeMobileNav} onOpenProfile={openProfile} />
        </div>
      </div>

      <MyProfileDialog
        open={isProfileOpen}
        onOpenChange={setIsProfileOpen}
        fallbackFocusRef={triggerRef}
      />
    </>
  )
}

const Brand = () => (
  <span className="font-heading text-base font-semibold tracking-tight text-sidebar-foreground">
    TutorLink
  </span>
)

const NavBody = ({ onNavigate, onOpenProfile }: NavBodyProps) => {
  const { logout } = useAuth()
  const role = useAuthStore((state) => state.role)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const navItems = role === null ? [] : adminNavItemsFor(role)

  const handleOpenProfile = () => {
    onNavigate?.()
    onOpenProfile()
  }

  const handleLogout = () => {
    setIsLoggingOut(true)
    onNavigate?.()
    logout()
  }

  return (
    <>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Admin">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={linkClasses} onClick={onNavigate}>
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            <span className="truncate">{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="space-y-1 border-t border-sidebar-border px-3 py-3">
        <button
          type="button"
          onClick={handleOpenProfile}
          aria-haspopup="dialog"
          className={footerButtonClasses}
        >
          <UserRound aria-hidden="true" className="size-4 shrink-0" />
          <span>My profile</span>
        </button>
        <button
          type="button"
          onClick={handleLogout}
          disabled={isLoggingOut}
          className={footerButtonClasses}
        >
          <LogOut aria-hidden="true" className="size-4 shrink-0" />
          <span>Logout</span>
        </button>
      </div>
    </>
  )
}
