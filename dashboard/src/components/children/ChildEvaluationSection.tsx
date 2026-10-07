import { useRef, useState, type RefObject } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2 } from 'lucide-react'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { errorDetail } from '@/lib/api'
import {
  addableSubjects,
  canMarkEvaluated,
  canRemoveLevel,
  CLEAR_FALLBACK_ERROR,
  clearEvaluatedBody,
  DEFAULT_LEVEL,
  evaluatedStatusLabel,
  INACTIVE_SUBJECT_SUFFIX,
  isLevelMuted,
  LAST_LEVEL_REASON,
  LEVEL_HEADERS,
  LEVEL_OPTIONS,
  LEVELS_EMPTY,
  levelFallbackError,
  MARK_FALLBACK_ERROR,
  MARK_NEEDS_LEVEL,
  NO_LEVEL_HINT_REST,
  notEvaluatedConsequence,
} from '@/lib/child-evaluation/childEvaluation'
import {
  clearChildEvaluated,
  markChildEvaluated,
  removeChildLevel,
  setChildLevel,
  type ChildDetail,
  type ChildLevel,
} from '@/lib/queries/children'
import { subjectQueries } from '@/lib/queries/subjects'
import { cn } from '@/lib/utils'

type ChildEvaluationSectionProps = { child: ChildDetail }

type LevelChange = { subjectId: string; subjectName: string; level: number }

type LevelRemoval = { subjectId: string; subjectName: string }

const SUBJECT_PAGE_SIZE = 100
const SUBJECTS_FALLBACK_ERROR = 'Could not load the Subjects to add.'
const alertClasses = 'text-sm font-medium text-destructive'
const mutedClasses = 'text-xs text-muted-foreground'
const buttonSizing = 'h-11 w-full sm:w-auto md:h-8'
// Run after React has committed the new tree, so the target exists and the dialog has closed.
const afterCommit = (action: () => void) => requestAnimationFrame(action)
const FLIP_ANIMATION =
  'animate-in fade-in-0 duration-200 ease-out motion-reduce:animate-none'

const LevelSelect = ({ ...props }: React.ComponentProps<typeof Select>) => (
  <Select {...props} className={cn('h-11 md:h-8', props.className)}>
    {LEVEL_OPTIONS.map((option) => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ))}
  </Select>
)

export const ChildEvaluationSection = ({ child }: ChildEvaluationSectionProps) => {
  const queryClient = useQueryClient()
  const [levelError, setLevelError] = useState<string | null>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const statusButton = useRef<HTMLButtonElement>(null)
  const levelsPanel = useRef<HTMLDivElement>(null)
  const addSubject = useRef<HTMLSelectElement>(null)

  // A success settles every earlier level error, whichever action raised it.
  const refresh = () => {
    setLevelError(null)
    markEvaluated.reset()

    return queryClient.invalidateQueries({ queryKey: ['children'] })
  }

  // The control that was used is disabled, or gone, once the write lands: keep the keyboard user
  // in the same place instead of letting focus fall to the page.
  const focusStatusButton = () => afterCommit(() => statusButton.current?.focus())

  const focusLevels = () =>
    afterCommit(() => {
      const select = [...(levelsPanel.current?.querySelectorAll('select') ?? [])].find(
        (candidate) => candidate.offsetParent !== null,
      )

      ;(select ?? addSubject.current)?.focus()
    })

  const changeLevel = useMutation({
    mutationFn: (change: LevelChange) => setChildLevel(child.id, change.subjectId, change.level),
    onMutate: () => setLevelError(null),
    onSuccess: refresh,
    onError: (error, change) =>
      setLevelError(errorDetail(error) ?? levelFallbackError('save', change.subjectName)),
  })

  const removeLevel = useMutation({
    mutationFn: (removal: LevelRemoval) => removeChildLevel(child.id, removal.subjectId),
    onMutate: () => setLevelError(null),
    onSuccess: async () => {
      await refresh()
      focusLevels()
    },
    onError: (error, removal) =>
      setLevelError(errorDetail(error) ?? levelFallbackError('remove', removal.subjectName)),
  })

  const markEvaluated = useMutation({
    mutationFn: () => markChildEvaluated(child.id),
    onSuccess: async () => {
      await refresh()
      focusStatusButton()
    },
  })

  const clearEvaluated = useMutation({
    mutationFn: () => clearChildEvaluated(child.id),
    onSuccess: async () => {
      await refresh()
      setClearOpen(false)
      focusStatusButton()
    },
  })

  const isEvaluated = child.evaluated !== null
  const isMarkAllowed = canMarkEvaluated(child)
  const isRemoveAllowed = canRemoveLevel(child)
  const isChanging = (subjectId: string) =>
    changeLevel.isPending && changeLevel.variables?.subjectId === subjectId

  const columns: Column<ChildLevel>[] = [
    {
      id: 'subject',
      header: LEVEL_HEADERS.subject,
      primary: true,
      cell: (entry) =>
        isLevelMuted(entry) ? (
          <span className="text-muted-foreground">
            {entry.name}
            <span className="ml-1.5 text-xs">{INACTIVE_SUBJECT_SUFFIX}</span>
          </span>
        ) : (
          entry.name
        ),
    },
    {
      id: 'level',
      header: LEVEL_HEADERS.level,
      cell: (entry) => (
        <div className="ml-auto w-24 md:ml-0">
          <LevelSelect
            aria-label={`${entry.name} level`}
            // Show the pick while its save is in flight, not the old value.
            value={isChanging(entry.subject_id) ? changeLevel.variables?.level : entry.level}
            disabled={isChanging(entry.subject_id)}
            onChange={(event) =>
              changeLevel.mutate({
                subjectId: entry.subject_id,
                subjectName: entry.name,
                level: Number(event.target.value),
              })
            }
          />
        </div>
      ),
    },
    { id: 'set_by', header: LEVEL_HEADERS.setBy, cell: (entry) => entry.set_by.display_name },
    {
      id: 'actions',
      header: LEVEL_HEADERS.actions,
      align: 'end',
      cell: (entry) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11 md:h-7"
          aria-label={`Remove ${entry.name} level`}
          aria-describedby={isRemoveAllowed ? undefined : 'last-level-reason'}
          disabled={removeLevel.isPending || !isRemoveAllowed}
          onClick={() =>
            removeLevel.mutate({ subjectId: entry.subject_id, subjectName: entry.name })
          }
        >
          {removeLevel.isPending && removeLevel.variables?.subjectId === entry.subject_id
            ? 'Removing…'
            : 'Remove'}
        </Button>
      ),
    },
  ]

  return (
    <section aria-labelledby="evaluation-heading" className="space-y-3">
      <h2 id="evaluation-heading" className="font-heading text-lg font-semibold tracking-tight">
        Evaluation
      </h2>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div key={String(isEvaluated)} className={cn('flex items-start gap-2', FLIP_ANIMATION)}>
            {isEvaluated ? (
              <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 text-primary" />
            ) : (
              <AlertCircle aria-hidden="true" className="mt-0.5 size-4 text-muted-foreground" />
            )}
            <div className="space-y-0.5">
              <p className="text-sm font-medium">{evaluatedStatusLabel(child.evaluated)}</p>
              {!isEvaluated && (
                <p className="text-sm text-muted-foreground">{notEvaluatedConsequence(child.name)}</p>
              )}
            </div>
          </div>

          {isEvaluated ? (
            <Button
              ref={statusButton}
              type="button"
              variant="outline"
              className={buttonSizing}
              onClick={() => setClearOpen(true)}
            >
              Clear evaluated
            </Button>
          ) : (
            <div className="flex w-full flex-col items-stretch gap-1 sm:w-auto sm:items-end">
              <Button
                ref={statusButton}
                type="button"
                className={buttonSizing}
                disabled={!isMarkAllowed || markEvaluated.isPending}
                aria-describedby={isMarkAllowed ? undefined : 'mark-evaluated-reason'}
                onClick={() => markEvaluated.mutate()}
              >
                {markEvaluated.isPending ? 'Marking…' : 'Mark evaluated'}
              </Button>
              {!isMarkAllowed && (
                <p id="mark-evaluated-reason" className={mutedClasses}>
                  {MARK_NEEDS_LEVEL}
                </p>
              )}
              {markEvaluated.isError && (
                <p role="alert" className={alertClasses}>
                  {errorDetail(markEvaluated.error) ?? MARK_FALLBACK_ERROR}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div ref={levelsPanel}>
        <DataTable
          caption="Subject levels"
          columns={columns}
          rows={child.levels}
          rowKey={(entry) => entry.subject_id}
          status="ready"
          emptyMessage={LEVELS_EMPTY}
        />
      </div>
      {!isRemoveAllowed && (
        <p id="last-level-reason" className={mutedClasses}>
          {LAST_LEVEL_REASON}
        </p>
      )}
      {levelError !== null && (
        <p role="alert" className={alertClasses}>
          {levelError}
        </p>
      )}

      <AddLevelCard child={child} onAdded={refresh} subjectSelect={addSubject} />

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={(open) => {
          setClearOpen(open)
          if (!open) clearEvaluated.reset()
        }}
        title="Clear evaluated"
        body={clearEvaluatedBody(child.name)}
        confirmLabel="Clear evaluated"
        pending={clearEvaluated.isPending}
        errorMessage={
          clearEvaluated.isError
            ? (errorDetail(clearEvaluated.error) ?? CLEAR_FALLBACK_ERROR)
            : null
        }
        onConfirm={() => clearEvaluated.mutate()}
      />
    </section>
  )
}

type AddLevelCardProps = {
  child: ChildDetail
  onAdded: () => Promise<unknown>
  subjectSelect: RefObject<HTMLSelectElement | null>
}

const AddLevelCard = ({ child, onAdded, subjectSelect }: AddLevelCardProps) => {
  const [subjectId, setSubjectId] = useState('')
  const [level, setLevel] = useState(DEFAULT_LEVEL)
  // One page of 100 is the API's cap; a catalogue larger than that needs a paged picker.
  const subjects = useQuery(subjectQueries.list({ is_active: true, page_size: SUBJECT_PAGE_SIZE }))

  const addable = addableSubjects(subjects.data?.items ?? [], child.levels)
  // The first addable subject stands in until one is picked, and again once the pick is taken.
  const selected = addable.find((subject) => subject.id === subjectId) ?? addable[0]

  const add = useMutation({
    mutationFn: (subject: { id: string; name: string }) =>
      setChildLevel(child.id, subject.id, Number(level)),
    onSuccess: async () => {
      await onAdded()
      setLevel(DEFAULT_LEVEL)
      afterCommit(() => subjectSelect.current?.focus())
    },
  })

  let content = null

  if (subjects.isError) {
    content = (
      <p role="alert" className={alertClasses}>
        {errorDetail(subjects.error) ?? SUBJECTS_FALLBACK_ERROR}
      </p>
    )
  } else if (selected !== undefined) {
    content = (
      <Card size="sm">
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full space-y-1.5 sm:w-40">
              <Label htmlFor="add-level-subject">Subject</Label>
              <Select
                ref={subjectSelect}
                id="add-level-subject"
                className="h-11 md:h-8"
                value={selected.id}
                disabled={add.isPending}
                onChange={(event) => setSubjectId(event.target.value)}
              >
                {addable.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-24 space-y-1.5">
              <Label htmlFor="add-level-level">Level</Label>
              <LevelSelect
                id="add-level-level"
                value={level}
                disabled={add.isPending}
                onChange={(event) => setLevel(event.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-8"
              disabled={add.isPending}
              onClick={() => add.mutate({ id: selected.id, name: selected.name })}
            >
              {add.isPending ? 'Adding…' : 'Add level'}
            </Button>
          </div>
          {add.isError && (
            <p role="alert" className={alertClasses}>
              {errorDetail(add.error) ?? levelFallbackError('add', add.variables?.name ?? selected.name)}
            </p>
          )}
          <ul className="space-y-1">
            {addable.map((subject) => (
              <li key={subject.id} className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{subject.name}</span>
                {NO_LEVEL_HINT_REST}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    )
  }

  return content
}
