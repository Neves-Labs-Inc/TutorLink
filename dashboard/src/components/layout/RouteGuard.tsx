import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'

type Role = 'admin' | 'tutor'

interface RouteGuardProps {
  allow: Role[]
  children: ReactNode
}

export function RouteGuard({ allow, children }: RouteGuardProps) {
  const status = useAuthStore((state) => state.status)
  const role = useAuthStore((state) => state.role)

  // The access token dies on reload while the refresh cookie survives, so on the first paint
  // of every page load the bootstrap refresh is still in flight and `role` is null without
  // the visitor being anonymous. Redirecting here would sign every user out on every reload.
  if (status === 'loading') {
    return <div aria-busy="true" />
  }

  if (role === null) {
    return <Navigate to="/login" replace />
  }

  if (!allow.includes(role)) {
    return <Navigate to={role === 'admin' ? '/dashboard' : '/schedule'} replace />
  }

  return children
}
