import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'

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
import { cn } from '@/lib/utils'

type SubjectDraft = {
  name: string
  description: string
  is_active: boolean
}

type View = { kind: 'list' } | { kind: 'form'; subject: Subject | null }

type UpdateVars = { id: string; data: SubjectUpdate; wasActive: boolean }

export type ManageSubjectsSlideOverProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubjectDeactivated?: (subjectId: string) => void
}

const EMPTY_DRAFT: SubjectDraft = { name: '', description: '', is_active: true }
const LIST_VIEW: View = { kind: 'list' }
const SAVE_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const SUBJECT_FORM_ID = 'subject-form'

const checkboxClasses = 'size-4 rounded border-input'
const checkboxLabelClasses = 'min-h-11 w-fit md:min-h-0'

const columns: Column<Subject>[] = [
  {
    id: 'name',
    header: 'Name',
    primary: true,
    cell: (row) => <span className="wrap-anywhere">{row.name}</span>,
  },
  {
    id: 'description',
    header: 'Description',
    cell: (row) => <span className="wrap-anywhere">{row.description ?? '—'}</span>,
  },
  { id: 'tutor_count', header: 'Tutors', align: 'end', cell: (row) => row.tutor_count },
  {
    id: 'is_active',
    header: 'Status',
    cell: (row) => <StatusBadge status={row.is_active ? 'active' : 'inactive'} />,
  },
]

const viewCopy = (view: View) => {
  if (view.kind === 'list') {
    return {
      title: 'Subjects',
      description: 'Add, edit or deactivate the subjects tutors teach.',
    }
  }
  if (view.subject) {
    return {
      title: 'Edit subject',
      description: 'Changes show on every tutor who teaches it.',
    }
  }
  return { title: 'Add subject', description: 'Once saved, it can be assigned to tutors.' }
}

export const ManageSubjectsSlideOver = ({
  open,
  onOpenChange,
  onSubjectDeactivated,
}: ManageSubjectsSlideOverProps) => {
  const queryClient = useQueryClient()
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const shouldFocusAddRef = useRef(false)

  const [wasOpen, setWasOpen] = useState(open)
  const [page, setPage] = useState(1)
  const [showInactive, setShowInactive] = useState(false)
  const [view, setView] = useState<View>(LIST_VIEW)
  const [draft, setDraft] = useState<SubjectDraft>(EMPTY_DRAFT)
  const [confirmOpen, setConfirmOpen] = useState(false)
  // Kept after the dialog closes so its body still names the subject during the exit fade.
  const [deactivateTarget, setDeactivateTarget] = useState<Subject | null>(null)

  // Reset on open, not on close: resetting on close would flip the title back to "Subjects"
  // during the panel's slide-out.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setPage(1)
      setShowInactive(false)
      setView(LIST_VIEW)
      setDraft(EMPTY_DRAFT)
      setConfirmOpen(false)
      setDeactivateTarget(null)
    }
  }

  const { data, isPending, isPlaceholderData, isError, error, refetch } = useQuery({
    ...subjectQueries.list({ is_active: !showInactive, page, page_size: DEFAULT_PAGE_SIZE }),
    enabled: open,
  })

  // Focus lands after the list view has mounted, so the footer button exists.
  useEffect(() => {
    if (view.kind === 'list' && shouldFocusAddRef.current) {
      shouldFocusAddRef.current = false
      addButtonRef.current?.focus()
    }
  }, [view])

  const refreshSubjectsAndTutors = async () => {
    void queryClient.invalidateQueries({ queryKey: ['tutors'] })
    await queryClient.invalidateQueries({ queryKey: ['subjects'] })
  }

  const returnToList = () => {
    shouldFocusAddRef.current = true
    setView(LIST_VIEW)
  }

  const createMutation = useMutation({
    mutationFn: createSubject,
    onSuccess: async () => {
      await refreshSubjectsAndTutors()
      setDraft(EMPTY_DRAFT)
      returnToList()
    },
  })

  const updateMutation = useMutation({
    mutationFn: (vars: UpdateVars) => updateSubject(vars.id, vars.data),
    onSuccess: async (_saved, vars) => {
      await refreshSubjectsAndTutors()
      if (vars.wasActive && !vars.data.is_active) {
        onSubjectDeactivated?.(vars.id)
      }
      returnToList()
    },
  })

  const deactivateMutation = useMutation({
    mutationFn: deactivateSubject,
    onSuccess: async (_saved, subjectId) => {
      await refreshSubjectsAndTutors()
      onSubjectDeactivated?.(subjectId)
      setConfirmOpen(false)
      returnToList()
    },
  })

  const editingSubject = view.kind === 'form' ? view.subject : null
  const activeMutation = editingSubject ? updateMutation : createMutation
  const subjects = data?.items ?? []
  const { title, description } = viewCopy(view)

  const openCreate = () => {
    setDraft(EMPTY_DRAFT)
    createMutation.reset()
    updateMutation.reset()
    setView({ kind: 'form', subject: null })
  }

  const openEdit = (subject: Subject) => {
    setDraft({
      name: subject.name,
      description: subject.description ?? '',
      is_active: subject.is_active,
    })
    createMutation.reset()
    updateMutation.reset()
    setView({ kind: 'form', subject })
  }

  const handleFilterChange = (nextShowInactive: boolean) => {
    setShowInactive(nextShowInactive)
    setPage(1)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextDescription = draft.description.trim() === '' ? null : draft.description

    if (editingSubject) {
      updateMutation.mutate({
        id: editingSubject.id,
        data: { name: draft.name, description: nextDescription, is_active: draft.is_active },
        wasActive: editingSubject.is_active,
      })
    } else {
      createMutation.mutate({ name: draft.name, description: nextDescription })
    }
  }

  const handleDeactivateClick = () => {
    setDeactivateTarget(editingSubject)
    deactivateMutation.reset()
    setConfirmOpen(true)
  }

  const handleDeactivateConfirm = () => {
    if (deactivateTarget) {
      deactivateMutation.mutate(deactivateTarget.id)
    }
  }

  const listFooter = (
    <Button
      ref={addButtonRef}
      type="button"
      className="h-11 w-full md:h-8 md:w-auto"
      onClick={openCreate}
    >
      Add subject
    </Button>
  )

  const formFooter = (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="submit"
        form={SUBJECT_FORM_ID}
        className="h-11 md:h-8"
        disabled={draft.name.trim() === '' || activeMutation.isPending}
      >
        {activeMutation.isPending ? 'Saving…' : 'Save'}
      </Button>
      <Button type="button" variant="outline" className="h-11 md:h-8" onClick={returnToList}>
        Cancel
      </Button>
      {editingSubject?.is_active && (
        <Button
          type="button"
          variant="destructive"
          className="ml-auto h-11 md:h-8"
          onClick={handleDeactivateClick}
        >
          Deactivate
        </Button>
      )}
    </div>
  )

  const listView = (
    <>
      <Label className={checkboxLabelClasses}>
        <input
          type="checkbox"
          checked={showInactive}
          onChange={(event) => handleFilterChange(event.target.checked)}
          className={checkboxClasses}
        />
        Show inactive subjects
      </Label>

      <div
        aria-busy={isPlaceholderData}
        className={cn(
          'space-y-4 transition-opacity duration-150 ease-out motion-reduce:transition-none',
          isPlaceholderData && 'opacity-60',
        )}
      >
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
            disabled={isPending || isPlaceholderData}
          />
        )}
      </div>
    </>
  )

  const formView = (
    <>
      <Button
        type="button"
        variant="ghost"
        className="-ml-2.5 h-11 md:h-8"
        onClick={returnToList}
      >
        <ChevronLeft data-icon="inline-start" aria-hidden="true" />
        Back to subjects
      </Button>
      <form id={SUBJECT_FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="subject-name">Name</Label>
          <Input
            id="subject-name"
            className="h-11 md:h-8"
            value={draft.name}
            autoFocus
            disabled={activeMutation.isPending}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="subject-description">Description (optional)</Label>
          <Textarea
            id="subject-description"
            value={draft.description}
            disabled={activeMutation.isPending}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </div>
        {editingSubject && (
          <Label className={checkboxLabelClasses}>
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
    </>
  )

  return (
    <>
      <SlideOver
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        description={description}
        footer={view.kind === 'list' ? listFooter : formFooter}
      >
        <div
          key={view.kind}
          className="animate-in space-y-4 duration-200 ease-out fade-in-0 motion-reduce:animate-none"
        >
          {view.kind === 'list' ? listView : formView}
        </div>
      </SlideOver>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Deactivate subject"
        body={
          <span className="wrap-anywhere">
            "{deactivateTarget?.name}" will no longer be available to assign to tutors.
          </span>
        }
        confirmLabel="Deactivate"
        onConfirm={handleDeactivateConfirm}
        destructive
        pending={deactivateMutation.isPending}
        errorMessage={deactivateMutation.isError ? errorDetail(deactivateMutation.error) : null}
      />
    </>
  )
}
