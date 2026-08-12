import { useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { errorDetail, requestLogin, requestLogout } from '@/lib/api'
import { decodeAccessToken, type Role } from '@/lib/auth'
import { useAuthStore } from '@/stores/authStore'

const LOGIN_FALLBACK_ERROR = 'Something went wrong. Please try again.'

function landingPath(role: Role): string {
  return role === 'admin' ? '/dashboard' : '/schedule'
}

export function useAuth() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const status = useAuthStore((state) => state.status)
  const role = useAuthStore((state) => state.role)
  const tutorId = useAuthStore((state) => state.tutorId)
  const setSession = useAuthStore((state) => state.setSession)
  const clearSession = useAuthStore((state) => state.clearSession)

  const loginMutation = useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const { data } = await requestLogin(email, password)
      const claims = decodeAccessToken(data.access_token)
      if (claims === null) throw new Error('Unreadable access token')
      return { accessToken: data.access_token, role: claims.role }
    },
    onSuccess: ({ accessToken, role: nextRole }) => {
      setSession({ accessToken })
      navigate(landingPath(nextRole), { replace: true })
    },
  })

  const logoutMutation = useMutation({
    mutationFn: requestLogout,
    onSuccess: () => {
      clearSession()
      // Without this the next user to sign in on this tab inherits the previous user's
      // cached rows — a data leak that stays invisible until there is data to cache.
      queryClient.clear()
      navigate('/login', { replace: true })
    },
  })

  const { mutate: loginMutate } = loginMutation
  const { mutate: logoutMutate } = logoutMutation

  const login = useCallback(
    (email: string, password: string) => loginMutate({ email, password }),
    [loginMutate],
  )
  const logout = useCallback(() => logoutMutate(), [logoutMutate])

  return {
    status,
    role,
    tutorId,
    login,
    logout,
    isLoggingIn: loginMutation.isPending,
    // Already a renderable string: the server's `detail` when it sent one, a fixed fallback
    // otherwise. Never a raw Axios error, a status code, or a stack.
    loginError:
      loginMutation.error === null
        ? null
        : (errorDetail(loginMutation.error) ?? LOGIN_FALLBACK_ERROR),
  }
}
