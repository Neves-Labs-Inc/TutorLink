import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueries } from '@tanstack/react-query'

import { SlideOver } from '@/components/shared/SlideOver'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { errorDetail } from '@/lib/api'
import { candidateHomes } from '@/lib/child-links/childLinks'
import { guardianQueries } from '@/lib/queries/guardians'
import { updateChild, type ChildDetail, type ChildRecord } from '@/lib/queries/children'

type AddChildHomeSlideOverProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  child: ChildDetail
  onSaved: (child: ChildRecord) => void
}

const FALLBACK_ERROR = 'Something went wrong. Please try again.'

export const AddChildHomeSlideOver = ({
  open,
  onOpenChange,
  child,
  onSaved,
}: AddChildHomeSlideOverProps) => {
  const [homeIds, setHomeIds] = useState<string[]>([])

  const guardianDetails = useQueries({
    queries: child.guardians.map((guardian) => ({ ...guardianQueries.detail(guardian.id), enabled: open })),
  })
  const guardiansPending = guardianDetails.some((query) => query.isPending)
  const guardiansErrored = guardianDetails.find((query) => query.isError)
  const candidates = candidateHomes(
    child,
    guardianDetails.flatMap((query) => (query.data ? [query.data] : [])),
  )

  const save = useMutation({
    mutationFn: () =>
      updateChild(child.id, { home_ids: [...child.homes.map((home) => home.id), ...homeIds] }),
    onSuccess: (record) => {
      onSaved(record)
      handleOpenChange(false)
    },
  })

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setHomeIds([])
      save.reset()
    }

    onOpenChange(next)
  }

  const toggleHome = (homeId: string) => {
    setHomeIds((current) =>
      current.includes(homeId) ? current.filter((id) => id !== homeId) : [...current, homeId],
    )
  }

  return (
    <SlideOver
      open={open}
      onOpenChange={handleOpenChange}
      title="Add home"
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            disabled={homeIds.length === 0 || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Add home'}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={save.isPending}
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {guardiansPending ? (
          <p className="text-sm text-muted-foreground">Loading homes…</p>
        ) : guardiansErrored ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {errorDetail(guardiansErrored.error) ?? FALLBACK_ERROR}
          </p>
        ) : candidates.length === 0 ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>No other homes on this child's guardians. Add one on a guardian's page first.</p>
            <ul className="list-inside list-disc">
              {child.guardians.map((guardian) => (
                <li key={guardian.id}>
                  <Link
                    to={`/guardians/${guardian.id}`}
                    className="text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {guardian.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ul className="space-y-2">
            {candidates.map((home) => (
              <li key={home.id} className="flex items-center gap-2">
                <input
                  id={`add-home-${home.id}`}
                  type="checkbox"
                  className="size-4 rounded-sm border-input accent-primary"
                  checked={homeIds.includes(home.id)}
                  disabled={save.isPending}
                  onChange={() => toggleHome(home.id)}
                />
                <Label htmlFor={`add-home-${home.id}`}>{home.label ?? home.address}</Label>
              </li>
            ))}
          </ul>
        )}
        {save.isError && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {errorDetail(save.error) ?? FALLBACK_ERROR}
          </p>
        )}
      </div>
    </SlideOver>
  )
}
