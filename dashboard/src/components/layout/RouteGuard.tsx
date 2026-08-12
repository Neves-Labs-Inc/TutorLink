import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'

type Role = 'admin' | 'tutor'

type RouteGuardProps = {
  allow: Role[]
  children: ReactNode
}

export const RouteGuard = ({ allow, children }: RouteGuardProps) => {
  const status = useAuthStore((state) => state.status)
  const role = useAuthStore((state) => state.role)
  let content: ReactNode

  // The access token dies on reload while the refresh cookie survives, so on the first paint
  // of every page load the bootstrap refresh is still in flight and `role` is null without
  // the visitor being anonymous. Redirecting here would sign every user out on every reload.
  if (status === 'loading') {
    content = <div aria-busy="true" />
  } else if (role === null) {
    content = <Navigate to="/login" replace />
  } else if (!allow.includes(role)) {
    content = <Navigate to={role === 'admin' ? '/dashboard' : '/schedule'} replace />
  } else {
    content = children
  }

  return content
}
