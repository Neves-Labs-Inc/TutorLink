export type Role = 'admin' | 'tutor'

export interface AccessTokenClaims {
  sub: string
  role: Role
  tutorId: string | null
  exp: number
}

// This decode is NOT verification. The signature is never checked in the browser and the
// claims below must never be trusted for an authorisation decision. The role is read only
// so the UI can pick which chrome to render; every real access decision belongs to the
// server, which re-verifies the token on every single request. A user who edits the payload
// in devtools changes what they see, never what they can reach.
export function decodeAccessToken(token: string): AccessTokenClaims | null {
  const segments = token.split('.')
  if (segments.length !== 3) return null

  try {
    const base64 = segments[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload: unknown = JSON.parse(atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')))
    if (typeof payload !== 'object' || payload === null) return null

    const { sub, role, tutor_id: tutorId, exp } = payload as Record<string, unknown>
    if (typeof sub !== 'string' || typeof exp !== 'number') return null
    if (role !== 'admin' && role !== 'tutor') return null

    return { sub, role, tutorId: typeof tutorId === 'string' ? tutorId : null, exp }
  } catch {
    return null
  }
}
