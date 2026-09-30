import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { Pager } from '@/components/shared/Pager'
import { SlideOver } from '@/components/shared/SlideOver'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { errorDetail } from '@/lib/api'
import { DEFAULT_PAGE_SIZE } from '@/lib/queries/page'
import {
  createSubject,
  deactivateSubject,
  subjectQueries,
  updateSubject,
  type Subject,
  type SubjectUpdate,
} from '@/lib/queries/subjects'

type SubjectDraft = {
  name: string
  description: string
  is_active: boolean
}

type UpdateVars = { id: string; data: SubjectUpdate }

const EMPTY_DRAFT: SubjectDraft = { name: '', description: '', is_active: true }
const SAVE_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const SUBJECT_FORM_ID = 'subject-form'

const checkboxClasses = 'size-4 rounded border-input'

const columns: Column<Subject>[] = [
  { id: 'name', header: 'Name', primary: true, cell: (row) => row.name },
  { id: 'description', header: 'Description', cell: (row) => row.description ?? '—' },
  { id: 'tutor_count', header: 'Tutors', align: 'end', cell: (row) => row.tutor_count },
  {
    id: 'is_active',
    header: 'Status',
    cell: (row) => <StatusBadge status={row.is_active ? 'active' : 'inactive'} />,
  },
]

export const Subjects = () => {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [showInactive, setShowInactive] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null)
  const [draft, setDraft] = useState<SubjectDraft>(EMPTY_DRAFT)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const { data, isPending, isError, error, refetch } = useQuery(
    subjectQueries.list({ is_active: !showInactive, page, page_size: DEFAULT_PAGE_SIZE }),
  )

  const createMutation = useMutation({
    mutationFn: createSubject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subjects'] })
      setFormOpen(false)
      setDraft(EMPTY_DRAFT)
    },
  })

  const updateMutation = useMutation({
    mutationFn: (vars: UpdateVars) => updateSubject(vars.id, vars.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subjects'] })
      setFormOpen(false)
    },
  })

  const deactivateMutation = useMutation({
    mutationFn: deactivateSubject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subjects'] })
      setConfirmOpen(false)
      setFormOpen(false)
    },
  })

  const activeMutation = editingSubject ? updateMutation : createMutation
  const subjects = data?.items ?? []

  const openCreate = () => {
    setEditingSubject(null)
    setDraft(EMPTY_DRAFT)
    createMutation.reset()
    updateMutation.reset()
    setFormOpen(true)
  }

  const openEdit = (subject: Subject) => {
    setEditingSubject(subject)
    setDraft({
      name: subject.name,
      description: subject.description ?? '',
      is_active: subject.is_active,
    })
    createMutation.reset()
    updateMutation.reset()
    setFormOpen(true)
  }

  const handleFilterChange = (nextShowInactive: boolean) => {
    setShowInactive(nextShowInactive)
    setPage(1)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const description = draft.description.trim() === '' ? null : draft.description

    if (editingSubject) {
      updateMutation.mutate({
        id: editingSubject.id,
        data: { name: draft.name, description, is_active: draft.is_active },
      })
    } else {
      createMutation.mutate({ name: draft.name, description })
    }
  }

  const handleDeactivateConfirm = () => {
    if (editingSubject) {
      deactivateMutation.mutate(editingSubject.id)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Subjects</h1>
        <Button type="button" onClick={openCreate}>
          Add Subject
        </Button>
      </div>

      <Label className="w-fit">
        <input
          type="checkbox"
          checked={showInactive}
          onChange={(event) => handleFilterChange(event.target.checked)}
          className={checkboxClasses}
        />
        Show inactive subjects
      </Label>

      <DataTable
        caption="Subjects"
        columns={columns}
        rows={subjects}
        rowKey={(row) => row.id}
        status={isPending ? 'pending' : isError ? 'error' : 'ready'}
        errorMessage={errorDetail(error)}
        onRetry={() => refetch()}
        emptyMessage={showInactive ? 'No inactive subjects.' : 'No active subjects.'}
        onRowSelect={openEdit}
      />

      {data && (
        <Pager
          page={page}
          pageSize={data.page_size}
          total={data.total}
          onPageChange={setPage}
          disabled={isPending}
        />
      )}

      <SlideOver
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editingSubject ? 'Edit Subject' : 'Add Subject'}
        footer={
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              form={SUBJECT_FORM_ID}
              disabled={draft.name.trim() === '' || activeMutation.isPending}
            >
              {activeMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            {editingSubject?.is_active && (
              <Button type="button" variant="destructive" onClick={() => setConfirmOpen(true)}>
                Deactivate
              </Button>
            )}
          </div>
        }
      >
        <form id={SUBJECT_FORM_ID} onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="subject-name">Name</Label>
            <Input
              id="subject-name"
              value={draft.name}
              disabled={activeMutation.isPending}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="subject-description">Description</Label>
            <Textarea
              id="subject-description"
              value={draft.description}
              disabled={activeMutation.isPending}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </div>
          {editingSubject && (
            <Label className="w-fit">
              <input
                type="checkbox"
                checked={draft.is_active}
                disabled={activeMutation.isPending}
                onChange={(event) => setDraft({ ...draft, is_active: event.target.checked })}
                className={checkboxClasses}
              />
              Active
            </Label>
          )}
          {activeMutation.isError && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {errorDetail(activeMutation.error) ?? SAVE_FALLBACK_ERROR}
            </p>
          )}
        </form>
      </SlideOver>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Deactivate subject"
        body={`"${editingSubject?.name}" will no longer be available to assign to tutors.`}
        confirmLabel="Deactivate"
        onConfirm={handleDeactivateConfirm}
        destructive
        pending={deactivateMutation.isPending}
        errorMessage={deactivateMutation.isError ? errorDetail(deactivateMutation.error) : null}
      />
    </div>
  )
}
