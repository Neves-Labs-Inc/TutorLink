import { useEffect, type ReactNode } from 'react'
import { refreshSession } from '@/lib/api'

type AuthProviderProps = {
  children: ReactNode
}

// Module-level, not a `useRef`: the bootstrap refresh must fire once per page load, full
// stop. `main.tsx` renders inside <React.StrictMode>, which deliberately mounts, unmounts
// and remounts every component in development, running this effect twice. Refresh tokens
// rotate on every use (D-017) and the server treats a replay as a breach — it revokes the
// whole family — so a second bootstrap refresh would log the user out the instant the page
// loads, in dev only, looking exactly like a backend bug.
//
// This flag and the single-flight promise in `refreshSession` are both required and cover
// different cases: the promise collapses refreshes that *overlap*, this flag stops a second
// one that starts *after* the first has already settled. A ref would also be scoped to one
// component instance, so any remount would start over.
let bootstrapStarted = false

// Gates nothing: RouteGuard reads `status` and decides what to render while it is
// 'loading'. Blocking here would flash a spinner over the login page too.
export const AuthProvider = ({ children }: AuthProviderProps) => {
  useEffect(() => {
    if (!bootstrapStarted) {
      bootstrapStarted = true

      refreshSession().catch(() => {
        // No cookie, or an expired/revoked one. `refreshSession` has already put the store in
        // the anonymous state, which is the correct resting state for a first-time visitor.
      })
    }
  }, [])

  return children
}
