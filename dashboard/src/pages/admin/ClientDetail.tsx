import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'

import { BookingHistorySection } from '@/components/clients/BookingHistorySection'
import { ChildrenSection } from '@/components/clients/ChildrenSection'
import { SlideOver } from '@/components/shared/SlideOver'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorDetail } from '@/lib/api'
import { clientQueries, updateClient, type ClientUpdate } from '@/lib/queries/clients'

type GuardianDraft = Required<ClientUpdate>

type DetailFieldProps = {
  label: string
  children: ReactNode
}

const EMPTY_DRAFT: GuardianDraft = { name: '', phone_number: '', is_active: true }
const FALLBACK_ERROR = 'Something went wrong. Please try again.'
const LOADING_ROWS = [0, 1, 2]
const GUARDIAN_FORM_ID = 'guardian-form'

export const ClientDetail = () => {
  const { id = '' } = useParams()
  const queryClient = useQueryClient()
  const { data, isPending, isError, error, refetch } = useQuery(clientQueries.detail(id))
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<GuardianDraft>(EMPTY_DRAFT)

  const save = useMutation({
    mutationFn: (values: GuardianDraft) => updateClient(id, values),
    onSuccess: (updated) => {
      queryClient.setQueryData(clientQueries.detail(id).queryKey, updated)
      setEditing(false)
    },
  })

  let content: ReactNode

  const handleEdit = (values: GuardianDraft) => {
    setDraft(values)
    save.reset()
    setEditing(true)
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      save.reset()
    }

    setEditing(open)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    save.mutate(draft)
  }

  if (isPending) {
    content = (
      <Card>
        <CardContent aria-busy="true" className="space-y-3">
          <p className="text-sm text-muted-foreground">Loading client…</p>
          {LOADING_ROWS.map((row) => (
            <div key={row} className="h-8 animate-pulse rounded-lg bg-muted" />
          ))}
        </CardContent>
      </Card>
    )
  } else if (isError) {
    content = (
      <Card>
        <CardContent className="space-y-4">
          <p role="alert" className="text-sm font-medium text-destructive">
            {errorDetail(error) ?? FALLBACK_ERROR}
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
        <Card>
          <CardHeader>
            <CardTitle>Guardian</CardTitle>
            <CardAction>
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  handleEdit({
                    name: data.name,
                    phone_number: data.phone_number,
                    is_active: data.is_active,
                  })
                }
              >
                Edit
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <DetailField label="Name">{data.name}</DetailField>
              <DetailField label="Phone number">{data.phone_number}</DetailField>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Homes</CardTitle>
            <CardDescription>
              A guardian may have more than one home, and a home may be shared with another
              guardian. A deactivated home stays listed here; the client list counts only the
              active ones.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.homes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No homes are linked to this guardian.</p>
            ) : (
              <ul className="space-y-3">
                {data.homes.map((home) => (
                  <li key={home.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{home.label ?? 'Home'}</p>
                      <StatusBadge status={home.is_active ? 'active' : 'inactive'} />
                    </div>
                    <dl className="mt-2 grid gap-3 sm:grid-cols-2">
                      <DetailField label="Address">{home.address}</DetailField>
                      <DetailField label="Access code">
                        <span className="font-mono">{home.access_code}</span>
                      </DetailField>
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <ChildrenSection clientId={id} />
        <BookingHistorySection clientId={id} />

        <SlideOver
          open={editing}
          onOpenChange={handleOpenChange}
          title="Edit guardian"
          description="Homes and children are managed elsewhere."
          footer={
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" form={GUARDIAN_FORM_ID} disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save changes'}
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
          <form id={GUARDIAN_FORM_ID} onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="guardian-name">Name</Label>
              <Input
                id="guardian-name"
                name="name"
                required
                autoComplete="off"
                value={draft.name}
                disabled={save.isPending}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="guardian-phone">Phone number</Label>
              <Input
                id="guardian-phone"
                name="phone_number"
                type="tel"
                required
                autoComplete="off"
                value={draft.phone_number}
                disabled={save.isPending}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, phone_number: event.target.value }))
                }
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="guardian-active"
                name="is_active"
                type="checkbox"
                className="size-4 rounded-sm border-input accent-primary"
                checked={draft.is_active}
                disabled={save.isPending}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, is_active: event.target.checked }))
                }
              />
              <Label htmlFor="guardian-active">Active</Label>
            </div>
            {save.isError && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {errorDetail(save.error) ?? FALLBACK_ERROR}
              </p>
            )}
          </form>
        </SlideOver>
      </>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          to="/clients"
          className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          Back to clients
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {data?.name ?? 'Client'}
          </h1>
          {data && <StatusBadge status={data.is_active ? 'active' : 'inactive'} />}
        </div>
      </div>
      {content}
    </div>
  )
}

const DetailField = ({ label, children }: DetailFieldProps) => (
  <div className="space-y-1">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="text-sm text-foreground">{children}</dd>
  </div>
)
