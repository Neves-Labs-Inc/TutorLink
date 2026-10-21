import { useCallback, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { flushDeferredActions } from '@/components/kit/overlays/use-deferred-action'
import {
  errorDetail,
  errorHeader,
  errorStatus,
  requestForgotPassword,
  requestLogin,
  requestLogout,
  requestSetPassword,
} from '@/lib/api'
import { decodeAccessToken, landingPath } from '@/lib/auth/auth'
import { getSignInFailure, type SignInFailure } from '@/lib/auth/sign-in'
import { useAuthStore } from '@/stores/authStore'

const LOGIN_FALLBACK_ERROR = 'Something went wrong. Please try again.'

export const useAuth = () => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const status = useAuthStore((state) => state.status)
  const role = useAuthStore((state) => state.role)
  const tutorId = useAuthStore((state) => state.tutorId)
  const setSession = useAuthStore((state) => state.setSession)
  const clearSession = useAuthStore((state) => state.clearSession)
  // Stamped when the failure arrives, so a lockout's countdown starts from the 429 itself.
  const [signInFailure, setSignInFailure] = useState<SignInFailure | null>(null)

  const loginMutation = useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const { data } = await requestLogin(email, password)
      const claims = decodeAccessToken(data.access_token)

      if (claims === null) throw new Error('Unreadable access token')

      return { accessToken: data.access_token, role: claims.role }
    },
    onMutate: () => setSignInFailure(null),
    onError: (error) =>
      setSignInFailure(
        getSignInFailure(errorStatus(error), errorHeader(error, 'Retry-After'), Date.now()),
      ),
    onSuccess: ({ accessToken, role: nextRole }) => {
      setSession({ accessToken })
      navigate(landingPath(nextRole), { replace: true })
    },
  })

  const setPasswordMutation = useMutation({
    mutationFn: async ({ token, password }: { token: string; password: string }) => {
      const { data } = await requestSetPassword(token, password)
      const claims = decodeAccessToken(data.access_token)

      if (claims === null) throw new Error('Unreadable access token')

      return { accessToken: data.access_token, role: claims.role }
    },
    onSuccess: ({ accessToken, role: nextRole }) => {
      // Someone already signed in who opens a link becomes that link's account: drop the
      // previous account's cached rows so they never show under the new one. Queries only: this mutation is still settling.
      queryClient.removeQueries()
      setSession({ accessToken })
      navigate(landingPath(nextRole), { replace: true })
    },
  })

  // Every 2xx reads the same (hit, miss or throttled), so only success or failure matters.
  const forgotPasswordMutation = useMutation({
    mutationFn: async (email: string) => {
      await requestForgotPassword(email)
    },
  })

  const logoutMutation = useMutation({
    mutationFn: async () => {
      // Pending Undo-window acts go out now, while the token is still in the store; once the
      // session clears they would be sent anonymously.
      flushDeferredActions()
      await requestLogout()
    },
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
  const { mutate: setPasswordMutate } = setPasswordMutation
  const { mutate: forgotPasswordMutate, reset: resetForgotPassword } = forgotPasswordMutation

  const setPasswordWithToken = useCallback(
    (token: string, password: string) => setPasswordMutate({ token, password }),
    [setPasswordMutate],
  )
  const forgotPassword = useCallback(
    (email: string) => forgotPasswordMutate(email),
    [forgotPasswordMutate],
  )
  const logout = useCallback(() => logoutMutate(), [logoutMutate])

  return {
    status,
    role,
    tutorId,
    login,
    logout,
    setPasswordWithToken,
    // Stays true after a 200 on purpose: navigation away is imminent and the form must not
    // flash back to enabled.
    isSettingPassword: setPasswordMutation.isPending || setPasswordMutation.isSuccess,
    // 400 = dead link, 422 = bad password; any other status (or none) is a plain failure.
    setPasswordFailure:
      setPasswordMutation.error === null
        ? null
        : {
            status: errorStatus(setPasswordMutation.error),
            detail: errorDetail(setPasswordMutation.error) ?? LOGIN_FALLBACK_ERROR,
          },
    forgotPassword,
    isSendingReset: forgotPasswordMutation.isPending,
    isResetSent: forgotPasswordMutation.isSuccess,
    hasResetFailed: forgotPasswordMutation.isError,
    // Back to the empty form ("send another link").
    resetForgotPassword,
    // Stays true after a 200 on purpose: the form holds its pending look through the redirect.
    isLoggingIn: loginMutation.isPending || loginMutation.isSuccess,
    // A typed reason, never the server's `detail`, a status code or a stack.
    signInFailure,
  }
}
