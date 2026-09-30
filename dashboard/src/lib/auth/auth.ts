const ROLES = ['admin', 'tutor', 'developer'] as const

export type Role = (typeof ROLES)[number]

export type AccessTokenClaims = {
  sub: string
  role: Role
  tutorId: string | null
  exp: number
}

export const ADMIN_ROLES: readonly Role[] = ['admin', 'developer']

const ADMIN_ROLE_SET: ReadonlySet<Role> = new Set(ADMIN_ROLES)

export const isAdminRole = (role: Role): boolean => ADMIN_ROLE_SET.has(role)

export const landingPath = (role: Role): string => (isAdminRole(role) ? '/dashboard' : '/schedule')

const isRole = (value: unknown): value is Role => (ROLES as readonly unknown[]).includes(value)

// This decode is NOT verification. The signature is never checked in the browser and the
// claims below must never be trusted for an authorisation decision. The role is read only
// so the UI can pick which chrome to render; every real access decision belongs to the
// server, which re-verifies the token on every single request. A user who edits the payload
// in devtools changes what they see, never what they can reach.
export const decodeAccessToken = (token: string): AccessTokenClaims | null => {
  const segments = token.split('.')
  let claims: AccessTokenClaims | null = null

  if (segments.length === 3) {
    try {
      const base64 = segments[1].replace(/-/g, '+').replace(/_/g, '/')
      const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
      const payload: unknown = JSON.parse(atob(padded))

      if (typeof payload === 'object' && payload !== null) {
        const { sub, role, tutor_id: tutorId, exp } = payload as Record<string, unknown>
        const usable = typeof sub === 'string' && typeof exp === 'number' && isRole(role)

        if (usable) {
          claims = { sub, role, tutorId: typeof tutorId === 'string' ? tutorId : null, exp }
        }
      }
    } catch {
      claims = null
    }
  }

  return claims
}
