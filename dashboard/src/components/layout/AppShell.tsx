import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { AdminSidebar } from './AdminSidebar'
import { TutorNav } from './TutorNav'

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const role = useAuthStore((state) => state.role)
  const { pathname } = useLocation()
  // Dev-only companion to the RouteGuard bypass (D-013): with no session, pick the chrome
  // from the route so /schedule exercises TutorNav and /dashboard exercises AdminSidebar.
  const isTutor =
    role === 'tutor' ||
    (import.meta.env.DEV && role === null && pathname.startsWith('/schedule'))

  return (
    <div className="flex min-h-dvh w-full flex-col bg-background text-foreground md:flex-row">
      {isTutor ? <TutorNav /> : <AdminSidebar />}
      <div className="flex min-w-0 flex-1 flex-col">
        <main
          className={cn(
            'mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8',
            isTutor && 'pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-6',
          )}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
