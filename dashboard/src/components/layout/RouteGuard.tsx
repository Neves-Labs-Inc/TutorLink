import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'

type Role = 'admin' | 'tutor'

interface RouteGuardProps {
  allow: Role[]
  children: ReactNode
}

export function RouteGuard({ allow, children }: RouteGuardProps) {
  const role = useAuthStore((state) => state.role)
  const accessToken = useAuthStore((state) => state.accessToken)

  if (role === null) {
    // Dev-only escape hatch (STATE.md D-013). Phase 1 ships no auth, so `role` is always
    // null and every protected route would otherwise redirect to /login, making the shell
    // impossible to inspect. `import.meta.env.DEV` is statically replaced with `false` by
    // `vite build`, so this branch is dead-code-eliminated from every production bundle.
    // Narrow or remove in Phase 2 when real login lands — see the note at the end of this task.
    const devNoAuth = import.meta.env.DEV && accessToken === null

    if (devNoAuth) {
      return children
    }

    return <Navigate to="/login" replace />
  }

  if (!allow.includes(role)) {
    return <Navigate to={role === 'admin' ? '/dashboard' : '/schedule'} replace />
  }

  return children
}
