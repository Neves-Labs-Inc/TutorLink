import { beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore } from './authStore'

const encodeToken = (payload: object): string =>
  `${btoa(JSON.stringify({ alg: 'none' }))}.${btoa(JSON.stringify(payload))}.sig`

describe('useAuthStore userId', () => {
  beforeEach(() => {
    useAuthStore.getState().clearSession()
  })

  it('exposes the token sub as userId', () => {
    useAuthStore
      .getState()
      .setSession({ accessToken: encodeToken({ sub: 'user-7', role: 'admin', exp: 1234567890 }) })

    expect(useAuthStore.getState().userId).toBe('user-7')
  })

  it('is null when anonymous', () => {
    expect(useAuthStore.getState().userId).toBeNull()
  })

  it('is null when the token will not decode', () => {
    useAuthStore.getState().setSession({ accessToken: 'not-a-token' })

    expect(useAuthStore.getState().userId).toBeNull()
  })

  it('is cleared with the session', () => {
    useAuthStore
      .getState()
      .setSession({ accessToken: encodeToken({ sub: 'user-7', role: 'admin', exp: 1234567890 }) })
    useAuthStore.getState().clearSession()

    expect(useAuthStore.getState().userId).toBeNull()
  })
})
