import type { ReactNode } from 'react'

import { chromeFor } from '@/lib/auth/auth'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { AdminSidebar } from './AdminSidebar'
import { TutorNav } from './TutorNav'

type AppShellProps = {
  children: ReactNode
}

export const AppShell = ({ children }: AppShellProps) => {
  const role = useAuthStore((state) => state.role)
  // The chrome follows the authenticated role; a guard has already established a non-null one.
  const isTutor = role !== null && chromeFor(role) === 'tutor'

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
