// PROTOTYPE (wayfinder #131) — throwaway. Three variants of the /bookings booking form and list
// for kind (Regular | Evaluation), Staff and Location, switchable via `?variant=A|B|C`.
// No `variant` param = the production Bookings page, untouched. All data is in memory.
import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'

import { AppShell } from '@/components/layout/AppShell'
import { PrototypeSwitcher } from '@/components/shared/PrototypeSwitcher'

import { BookingsVariantA } from './BookingsVariantA'
import { BookingsVariantB } from './BookingsVariantB'
import { BookingsVariantC } from './BookingsVariantC'
import { INITIAL_BOOKINGS, type MockBooking } from './mockData'

const VARIANTS = [
  { key: 'A', name: 'Kind first' },
  { key: 'B', name: 'Staff/Child first, kind inferred' },
  { key: 'C', name: 'Separate entry points' },
]

// Dev-only: with `?variant=` the route skips the auth guard (the variants need no backend);
// without it, the real guarded page renders.
export const BookingsRoute = ({ guarded }: { guarded: ReactNode }) => {
  const [searchParams] = useSearchParams()
  const variant = searchParams.get('variant')?.toUpperCase()

  if (import.meta.env.PROD || variant === undefined) return guarded

  return (
    <AppShell>
      <BookingsPrototype variant={variant} />
    </AppShell>
  )
}

const BookingsPrototype = ({ variant }: { variant: string }) => {
  // Lives above the variants so bookings created in one survive a switch to another.
  const [bookings, setBookings] = useState<MockBooking[]>(INITIAL_BOOKINGS)
  const onCreate = (booking: MockBooking) => setBookings((current) => [...current, booking])
  const props = { bookings, onCreate }

  return (
    <div className="pb-16">
      {variant === 'A' && <BookingsVariantA {...props} />}
      {variant === 'B' && <BookingsVariantB {...props} />}
      {variant === 'C' && <BookingsVariantC {...props} />}
      <PrototypeSwitcher variants={VARIANTS} current={variant} />
    </div>
  )
}
