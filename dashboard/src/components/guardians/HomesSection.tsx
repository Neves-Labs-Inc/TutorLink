import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
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
import { Label } from '@/components/ui/label'
import { errorDetail } from '@/lib/api'
import {
  EMPTY_HOME_DRAFT,
  homeDraftErrors,
  homeDraftFrom,
  homeInput,
  homeUpdate,
  type HomeDraft,
} from '@/lib/homes/homes'
import type { GuardianDetail, Home } from '@/lib/queries/guardians'
import { createHome, updateHome } from '@/lib/queries/homes'

import { HomeFields } from './HomeFields'

type HomesSectionProps = {
  guardianId: string
  guardian: GuardianDetail
}

const FALLBACK_ERROR = 'Something went wrong. Please try again.'
const ADD_HOME_FORM_ID = 'add-home-form'
const EDIT_HOME_FORM_ID = 'edit-home-form'

export const HomesSection = ({ guardianId, guardian }: HomesSectionProps) => {
  const queryClient = useQueryClient()
  const activeChildren = guardian.children.filter((child) => child.is_active)

  const [addOpen, setAddOpen] = useState(false)
  const [addDraft, setAddDraft] = useState<HomeDraft>(EMPTY_HOME_DRAFT)
  const [addChildIds, setAddChildIds] = useState<string[]>([])
  const [addErrors, setAddErrors] = useState<string[]>([])

  const [editingHome, setEditingHome] = useState<Home | null>(null)
  const [editDraft, setEditDraft] = useState<HomeDraft>(EMPTY_HOME_DRAFT)
  const [editErrors, setEditErrors] = useState<string[]>([])

  const [statusHome, setStatusHome] = useState<Home | null>(null)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['guardians'] })
    queryClient.invalidateQueries({ queryKey: ['children'] })
  }

  const closeAdd = () => {
    setAddOpen(false)
    setAddDraft(EMPTY_HOME_DRAFT)
    setAddChildIds([])
    setAddErrors([])
    createMutation.reset()
  }

  const openAdd = () => {
    setAddDraft(EMPTY_HOME_DRAFT)
    setAddChildIds(activeChildren.map((child) => child.id))
    setAddErrors([])
    setAddOpen(true)
  }

  const createMutation = useMutation({
    mutationFn: () => createHome(guardianId, { ...homeInput(addDraft), child_ids: addChildIds }),
    onSuccess: () => {
      invalidate()
      closeAdd()
    },
  })

  const handleAddSubmit = () => {
    const errors = homeDraftErrors(addDraft)

    if (errors.length > 0) {
      setAddErrors(errors)
    } else {
      setAddErrors([])
      createMutation.mutate()
    }
  }

  const toggleAddChild = (childId: string) =>
    setAddChildIds((current) =>
      current.includes(childId)
        ? current.filter((id) => id !== childId)
        : [...current, childId],
    )

  const closeEdit = () => {
    setEditingHome(null)
    setEditDraft(EMPTY_HOME_DRAFT)
    setEditErrors([])
    editMutation.reset()
  }

  const openEdit = (home: Home) => {
    setEditingHome(home)
    setEditDraft(homeDraftFrom(home))
    setEditErrors([])
    editMutation.reset()
  }

  const editMutation = useMutation({
    mutationFn: (data: ReturnType<typeof homeUpdate>) => updateHome(editingHome!.id, data),
    onSuccess: () => {
      invalidate()
      closeEdit()
    },
  })

  const handleEditSubmit = () => {
    if (editingHome === null) {
      return
    }

    const errors = homeDraftErrors(editDraft)

    if (errors.length > 0) {
      setEditErrors(errors)
      return
    }

    setEditErrors([])

    const update = homeUpdate(editDraft, editingHome)

    if (Object.keys(update).length === 0) {
      closeEdit()
    } else {
      editMutation.mutate(update)
    }
  }

  const statusMutation = useMutation({
    mutationFn: (home: Home) => updateHome(home.id, { is_active: !home.is_active }),
    onSuccess: () => {
      invalidate()
      setStatusHome(null)
    },
  })

  const closeStatus = () => {
    setStatusHome(null)
    statusMutation.reset()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Homes</CardTitle>
        <CardDescription>
          A guardian may have more than one home, and a home may be shared with another guardian.
          A deactivated home stays listed here; the guardian list counts only the active ones.
        </CardDescription>
        <CardAction>
          <Button type="button" size="sm" onClick={openAdd}>
            Add home
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {guardian.homes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No homes are linked to this guardian.</p>
        ) : (
          <ul className="space-y-3">
            {guardian.homes.map((home) => (
              <li key={home.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{home.label ?? 'Home'}</p>
                  <StatusBadge status={home.is_active ? 'active' : 'inactive'} />
                  <div className="ml-auto flex gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => openEdit(home)}>
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setStatusHome(home)}
                    >
                      {home.is_active ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </div>
                </div>
                <dl className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <dt className="text-xs text-muted-foreground">Address</dt>
                    <dd className="text-sm text-foreground">{home.address}</dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="text-xs text-muted-foreground">Access code</dt>
                    <dd className="text-sm text-foreground">
                      <span className="font-mono">{home.access_code}</span>
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <SlideOver
        open={addOpen}
        onOpenChange={(open) => {
          if (!open && !createMutation.isPending) closeAdd()
        }}
        title="Add home"
        footer={
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              form={ADD_HOME_FORM_ID}
              disabled={createMutation.isPending}
              onClick={handleAddSubmit}
            >
              {createMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={createMutation.isPending}
              onClick={closeAdd}
            >
              Cancel
            </Button>
          </div>
        }
      >
        <form id={ADD_HOME_FORM_ID} className="space-y-4" onSubmit={(event) => event.preventDefault()}>
          <HomeFields
            idPrefix="add-home"
            value={addDraft}
            onChange={setAddDraft}
            disabled={createMutation.isPending}
          />
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-muted-foreground">Tutored here</legend>
            {activeChildren.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This guardian has no active children yet.
              </p>
            ) : (
              <div className="space-y-2">
                {activeChildren.map((child) => (
                  <div key={child.id} className="flex items-center gap-2">
                    <input
                      id={`add-home-child-${child.id}`}
                      type="checkbox"
                      className="size-4 rounded-sm border-input accent-primary"
                      checked={addChildIds.includes(child.id)}
                      disabled={createMutation.isPending}
                      onChange={() => toggleAddChild(child.id)}
                    />
                    <Label htmlFor={`add-home-child-${child.id}`}>{child.name}</Label>
                  </div>
                ))}
              </div>
            )}
          </fieldset>
          {(addErrors.length > 0 || createMutation.isError) && (
            <ul role="alert" className="space-y-1 text-sm font-medium text-destructive">
              {addErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
              {createMutation.isError && (
                <li>{errorDetail(createMutation.error) ?? FALLBACK_ERROR}</li>
              )}
            </ul>
          )}
        </form>
      </SlideOver>

      <SlideOver
        open={editingHome !== null}
        onOpenChange={(open) => {
          if (!open && !editMutation.isPending) closeEdit()
        }}
        title="Edit home"
        footer={
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              form={EDIT_HOME_FORM_ID}
              disabled={editMutation.isPending}
              onClick={handleEditSubmit}
            >
              {editMutation.isPending ? 'Saving…' : 'Save changes'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={editMutation.isPending}
              onClick={closeEdit}
            >
              Cancel
            </Button>
          </div>
        }
      >
        <form id={EDIT_HOME_FORM_ID} className="space-y-4" onSubmit={(event) => event.preventDefault()}>
          <HomeFields
            idPrefix="edit-home"
            value={editDraft}
            onChange={setEditDraft}
            disabled={editMutation.isPending}
          />
          {(editErrors.length > 0 || editMutation.isError) && (
            <ul role="alert" className="space-y-1 text-sm font-medium text-destructive">
              {editErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
              {editMutation.isError && (
                <li>{errorDetail(editMutation.error) ?? FALLBACK_ERROR}</li>
              )}
            </ul>
          )}
        </form>
      </SlideOver>

      <ConfirmDialog
        open={statusHome !== null}
        onOpenChange={(open) => {
          if (!open) closeStatus()
        }}
        title={statusHome?.is_active ? 'Deactivate home' : 'Reactivate home'}
        body={`${statusHome?.is_active ? 'Deactivate' : 'Reactivate'} ${
          statusHome === null ? 'this home' : `"${statusHome.label ?? statusHome.address}"`
        }?`}
        confirmLabel={statusHome?.is_active ? 'Deactivate' : 'Reactivate'}
        destructive={statusHome?.is_active ?? false}
        pending={statusMutation.isPending}
        errorMessage={statusMutation.isError ? errorDetail(statusMutation.error) ?? FALLBACK_ERROR : null}
        onConfirm={() => {
          if (statusHome !== null) {
            statusMutation.mutate(statusHome)
          }
        }}
      />
    </Card>
  )
}
