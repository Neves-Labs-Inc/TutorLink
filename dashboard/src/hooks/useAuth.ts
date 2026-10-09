import { useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  errorDetail,
  errorStatus,
  requestForgotPassword,
  requestLogin,
  requestLogout,
  requestSetPassword,
} from '@/lib/api'
import { decodeAccessToken, landingPath } from '@/lib/auth/auth'
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

  const setPasswordMutation = useMutation({
    mutationFn: async ({ token, password }: { token: string; password: string }) => {
      const { data } = await requestSetPassword(token, password)
      const claims = decodeAccessToken(data.access_token)

      if (claims === null) throw new Error('Unreadable access token')

      return { accessToken: data.access_token, role: claims.role }
    },
    onSuccess: ({ accessToken, role: nextRole }) => {
      setSession({ accessToken })
      navigate(landingPath(nextRole), { replace: true })
    },
  })

  const forgotPasswordMutation = useMutation({
    mutationFn: async (email: string) => {
      const { data } = await requestForgotPassword(email)

      return data.detail
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
  const { mutate: setPasswordMutate } = setPasswordMutation
  const { mutate: forgotPasswordMutate } = forgotPasswordMutation

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
    // The server's confirmation sentence once any 2xx came back, else null.
    forgotPasswordConfirmation: forgotPasswordMutation.isSuccess
      ? forgotPasswordMutation.data
      : null,
    forgotPasswordError: forgotPasswordMutation.isError ? LOGIN_FALLBACK_ERROR : null,
    isLoggingIn: loginMutation.isPending,
    // Already a renderable string: the server's `detail` when it sent one, a fixed fallback
    // otherwise. Never a raw Axios error, a status code, or a stack.
    loginError:
      loginMutation.error === null
        ? null
        : (errorDetail(loginMutation.error) ?? LOGIN_FALLBACK_ERROR),
  }
}
