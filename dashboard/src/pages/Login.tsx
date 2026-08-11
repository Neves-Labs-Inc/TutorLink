import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface FieldErrors {
  email?: string
  password?: string
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)

  function validate(): FieldErrors {
    const next: FieldErrors = {}
    if (!email.trim()) next.email = 'Enter your email address.'
    else if (!EMAIL_PATTERN.test(email.trim())) next.email = 'Enter a valid email address.'
    if (!password) next.password = 'Enter your password.'
    else if (password.length < 8) next.password = 'Password must be at least 8 characters.'
    return next
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const nextErrors = validate()
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    // Presentation only. Phase 2 replaces this with the real sign-in request.
    setSubmitting(true)
    window.setTimeout(() => setSubmitting(false), 1200)
  }

  const disabledInput =
    'disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border'

  return (
    <div className="grid min-h-dvh w-full place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <Card className="ring-border">
          <CardHeader>
            <CardTitle className="text-xl">TutorLink</CardTitle>
            <CardDescription>Sign in to manage tutors, clients, and bookings.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  placeholder="you@example.com"
                  value={email}
                  disabled={submitting}
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? 'email-error' : undefined}
                  onChange={(event) => setEmail(event.target.value)}
                  className={`h-10 ${disabledInput}`}
                />
                {errors.email && (
                  <p id="email-error" role="alert" className="text-sm font-medium text-destructive">
                    {errors.email}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  disabled={submitting}
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? 'password-error' : undefined}
                  onChange={(event) => setPassword(event.target.value)}
                  className={`h-10 ${disabledInput}`}
                />
                {errors.password && (
                  <p
                    id="password-error"
                    role="alert"
                    className="text-sm font-medium text-destructive"
                  >
                    {errors.password}
                  </p>
                )}
              </div>

              <Button
                type="submit"
                disabled={submitting}
                className="h-10 w-full disabled:border-border disabled:bg-transparent disabled:text-muted-foreground disabled:opacity-100"
              >
                {submitting ? 'Signing in…' : 'Log in'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Trouble signing in? Contact your administrator.
        </p>
      </div>
    </div>
  )
}
