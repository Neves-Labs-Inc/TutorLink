import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { guardDecision, type Role } from '@/lib/auth/auth'
import { useAuthStore } from '@/stores/authStore'

type RouteGuardProps = {
  allow: readonly Role[]
  children: ReactNode
}

export const RouteGuard = ({ allow, children }: RouteGuardProps) => {
  const status = useAuthStore((state) => state.status)
  const role = useAuthStore((state) => state.role)
  const decision = guardDecision(status, role, allow)
  let content: ReactNode = children

  if (decision.kind === 'wait') {
    content = <div aria-busy="true" />
  } else if (decision.kind === 'redirect') {
    content = <Navigate to={decision.to} replace />
  }

  return content
}
