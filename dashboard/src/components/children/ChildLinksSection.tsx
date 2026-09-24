import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { AddChildHomeSlideOver } from '@/components/children/AddChildHomeSlideOver'
import { LinkGuardianSlideOver } from '@/components/children/LinkGuardianSlideOver'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { errorDetail } from '@/lib/api'
import { withoutId } from '@/lib/child-links/childLinks'
import { formatPhoneForDisplay } from '@/lib/guardians/guardians'
import { childQueries, updateChild } from '@/lib/queries/children'

type ChildLinksSectionProps = { childId: string }

const FALLBACK_ERROR = 'Something went wrong. Please try again.'
const LOADING_ROWS = [0, 1]

const invalidateAfterLinkChange = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({ queryKey: ['children'] })
  queryClient.invalidateQueries({ queryKey: ['guardians'] })
  queryClient.invalidateQueries({ queryKey: ['households'] })
}

export const ChildLinksSection = ({ childId }: ChildLinksSectionProps) => {
  const queryClient = useQueryClient()
  const { data, isPending, isError, error, refetch } = useQuery(childQueries.detail(childId))
  const [addGuardianOpen, setAddGuardianOpen] = useState(false)
  const [addHomeOpen, setAddHomeOpen] = useState(false)
  const [removeGuardianId, setRemoveGuardianId] = useState<string | null>(null)
  const [removeHomeId, setRemoveHomeId] = useState<string | null>(null)

  const removeGuardian = useMutation({
    mutationFn: (guardianId: string) =>
      updateChild(childId, { guardian_ids: withoutId(data?.guardians ?? [], guardianId) }),
    onSuccess: () => {
      invalidateAfterLinkChange(queryClient)
      setRemoveGuardianId(null)
    },
  })

  const removeHome = useMutation({
    mutationFn: (homeId: string) =>
      updateChild(childId, { home_ids: withoutId(data?.homes ?? [], homeId) }),
    onSuccess: () => {
      invalidateAfterLinkChange(queryClient)
      setRemoveHomeId(null)
    },
  })

  const openRemoveGuardian = (guardianId: string) => {
    removeGuardian.reset()
    setRemoveGuardianId(guardianId)
  }

  const closeRemoveGuardian = () => {
    removeGuardian.reset()
    setRemoveGuardianId(null)
  }

  const openRemoveHome = (homeId: string) => {
    removeHome.reset()
    setRemoveHomeId(homeId)
  }

  const closeRemoveHome = () => {
    removeHome.reset()
    setRemoveHomeId(null)
  }

  let content: ReactNode

  if (isPending) {
    content = (
      <div aria-busy="true" className="space-y-3">
        <p className="text-sm text-muted-foreground">Loading guardians and homes…</p>
        {LOADING_ROWS.map((row) => (
          <div key={row} className="h-24 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    )
  } else if (isError) {
    content = (
      <div className="space-y-4">
        <p role="alert" className="text-sm font-medium text-destructive">
          {errorDetail(error) ?? FALLBACK_ERROR}
        </p>
        <Button type="button" variant="outline" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    )
  } else {
    const child = data
    const pendingGuardian = child.guardians.find((guardian) => guardian.id === removeGuardianId) ?? null
    const pendingHome = child.homes.find((home) => home.id === removeHomeId) ?? null
    const hasActiveHome = child.homes.some((home) => home.is_active)

    content = (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Guardians</CardTitle>
            <CardAction>
              <Button type="button" size="sm" onClick={() => setAddGuardianOpen(true)}>
                Add guardian
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {child.guardians.length === 0 ? (
              <p className="text-sm text-muted-foreground">No guardians are linked to this child.</p>
            ) : (
              <ul className="space-y-3">
                {child.guardians.map((guardian) => {
                  const onlyGuardian = child.guardians.length <= 1

                  return (
                    <li
                      key={guardian.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
                    >
                      <div className="space-y-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                          <Link
                            to={`/guardians/${guardian.id}`}
                            className="underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                          >
                            {guardian.name}
                          </Link>
                          {!guardian.is_active && <StatusBadge status="inactive" />}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {formatPhoneForDisplay(guardian.phone_number)}
                        </p>
                      </div>
                      {onlyGuardian ? (
                        <span title="A child needs at least one guardian">
                          <Button type="button" size="sm" variant="outline" disabled>
                            Remove
                          </Button>
                        </span>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => openRemoveGuardian(guardian.id)}
                        >
                          Remove
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Homes</CardTitle>
            <CardAction>
              <Button type="button" size="sm" onClick={() => setAddHomeOpen(true)}>
                Add home
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-3">
            {!hasActiveHome && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {child.name} has no active home and cannot be booked until one is added.
              </p>
            )}
            {child.homes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No homes are linked to this child.</p>
            ) : (
              <ul className="space-y-3">
                {child.homes.map((home) => {
                  const onlyHome = child.homes.length <= 1

                  return (
                    <li key={home.id} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-foreground">
                            {home.label ?? home.address}
                          </p>
                          {!home.is_active && <StatusBadge status="inactive" />}
                        </div>
                        {onlyHome ? (
                          <span title="A child needs at least one home">
                            <Button type="button" size="sm" variant="outline" disabled>
                              Remove
                            </Button>
                          </span>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => openRemoveHome(home.id)}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                      <dl className="mt-2 grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <dt className="text-xs text-muted-foreground">Address</dt>
                          <dd className="text-sm text-foreground">{home.address}</dd>
                        </div>
                        <div className="space-y-1">
                          <dt className="text-xs text-muted-foreground">Access code</dt>
                          <dd className="text-sm font-mono text-foreground">{home.access_code}</dd>
                        </div>
                      </dl>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <LinkGuardianSlideOver
          open={addGuardianOpen}
          onOpenChange={setAddGuardianOpen}
          child={child}
          onLinked={() => invalidateAfterLinkChange(queryClient)}
        />
        <AddChildHomeSlideOver
          open={addHomeOpen}
          onOpenChange={setAddHomeOpen}
          child={child}
          onSaved={() => invalidateAfterLinkChange(queryClient)}
        />

        <ConfirmDialog
          open={pendingGuardian !== null}
          onOpenChange={(next) => {
            if (!next) closeRemoveGuardian()
          }}
          title={`Remove ${pendingGuardian?.name ?? 'guardian'}?`}
          body={`${pendingGuardian?.name ?? 'This guardian'} will no longer be linked to ${child.name}.`}
          confirmLabel="Remove"
          destructive
          pending={removeGuardian.isPending}
          errorMessage={errorDetail(removeGuardian.error)}
          onConfirm={() => {
            if (removeGuardianId !== null) removeGuardian.mutate(removeGuardianId)
          }}
        />

        <ConfirmDialog
          open={pendingHome !== null}
          onOpenChange={(next) => {
            if (!next) closeRemoveHome()
          }}
          title={`Remove ${pendingHome?.label ?? pendingHome?.address ?? 'home'}?`}
          body={`${child.name} will no longer be linked to this home.`}
          confirmLabel="Remove"
          destructive
          pending={removeHome.isPending}
          errorMessage={errorDetail(removeHome.error)}
          onConfirm={() => {
            if (removeHomeId !== null) removeHome.mutate(removeHomeId)
          }}
        />
      </div>
    )
  }

  return content
}
