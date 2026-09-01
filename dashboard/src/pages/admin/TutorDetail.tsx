import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'

import { StatusBadge } from '@/components/shared/StatusBadge'
import { AvailabilitySection } from '@/components/tutors/AvailabilitySection'
import { ExceptionsSection } from '@/components/tutors/ExceptionsSection'
import { ProfileSection } from '@/components/tutors/ProfileSection'
import { SubjectsSection } from '@/components/tutors/SubjectsSection'
import { TutorBookingsSection } from '@/components/tutors/TutorBookingsSection'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { errorDetail } from '@/lib/api'
import { tutorQueries } from '@/lib/queries/tutors'

const NOT_FOUND_DETAIL = 'Tutor not found'
const LOAD_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const LOADING_ROWS = [0, 1, 2]

export const TutorDetail = () => {
  const { id = '' } = useParams()
  const { data: tutor, isPending, isError, error, refetch } = useQuery(tutorQueries.detail(id))
  let content: ReactNode

  if (isPending) {
    content = (
      <Card>
        <CardContent aria-busy="true" className="space-y-3">
          <p className="text-sm text-muted-foreground">Loading tutor…</p>
          {LOADING_ROWS.map((row) => (
            <div key={row} className="h-8 animate-pulse rounded-lg bg-muted" />
          ))}
        </CardContent>
      </Card>
    )
  } else if (isError && errorDetail(error) === NOT_FOUND_DETAIL) {
    content = (
      <Card>
        <CardContent className="space-y-4">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Tutor not found</h1>
          <p className="text-sm text-muted-foreground">
            No tutor exists with this id. It may have been removed, or the link may be wrong.
          </p>
          <Button asChild variant="outline">
            <Link to="/tutors">Back to tutors</Link>
          </Button>
        </CardContent>
      </Card>
    )
  } else if (isError) {
    content = (
      <Card>
        <CardContent className="space-y-4">
          <p role="alert" className="text-sm font-medium text-destructive">
            {errorDetail(error) ?? LOAD_FALLBACK_ERROR}
          </p>
          <Button type="button" variant="outline" onClick={() => refetch()}>
            Try again
          </Button>
        </CardContent>
      </Card>
    )
  } else {
    content = (
      <>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{tutor.name}</h1>
          <StatusBadge status={tutor.is_active ? 'active' : 'inactive'} />
        </div>
        <ProfileSection tutorId={tutor.id} />
        <SubjectsSection tutorId={tutor.id} />
        <AvailabilitySection tutorId={tutor.id} />
        <ExceptionsSection tutorId={tutor.id} />
        <TutorBookingsSection tutorId={tutor.id} />
      </>
    )
  }

  return (
    <div className="space-y-6">
      <Link
        to="/tutors"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to tutors
      </Link>
      {content}
    </div>
  )
}
