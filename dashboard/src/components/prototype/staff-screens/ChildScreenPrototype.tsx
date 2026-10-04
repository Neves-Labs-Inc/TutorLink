// PROTOTYPE ONLY (ticket #112, screen `child`). Three structurally different variants:
// A inline section on the child page, B read-only summary + Evaluate slide-over, C subject matrix.
import { useState, type ReactNode } from 'react'
import { AlertCircle, ArrowLeft, CheckCircle2, X } from 'lucide-react'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { SlideOver } from '@/components/shared/SlideOver'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import {
  LAST_LEVEL_REASON,
  MARK_NEEDS_LEVEL_REASON,
  NO_LEVEL_CONSEQUENCE,
  NOT_EVALUATED_CONSEQUENCE,
  useChildEvaluationPrototype,
  type ChildEvaluationPrototype,
} from '@/hooks/prototype/useChildEvaluationPrototype'
import {
  ACTIVE_SUBJECTS,
  findSubject,
  formatLevel,
  formatOverallGrade,
  GRADE_VALUES,
  type PrototypeChild,
  type PrototypeSubjectLevel,
} from '@/lib/prototype/staffScreensData'
import { cn } from '@/lib/utils'

type ChildScreenPrototypeProps = {
  variant: string
  child: PrototypeChild
  showInactiveLevel: boolean
}

type VariantProps = { evaluation: ChildEvaluationPrototype }

const OVERALL_GRADE_LABEL = 'Overall grade (estimate)'
const OVERALL_GRADE_HINT = 'Asked at Intake. Staff-only estimate, never used for matching.'
const NO_GRADE = ''

const backLinkClasses =
  'inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

export const ChildScreenPrototype = ({ variant, child, showInactiveLevel }: ChildScreenPrototypeProps) => {
  const evaluation = useChildEvaluationPrototype(child, showInactiveLevel)

  let content: ReactNode = <ChildVariantA evaluation={evaluation} />
  if (variant === 'B') content = <ChildVariantB evaluation={evaluation} />
  if (variant === 'C') content = <ChildVariantC evaluation={evaluation} />
  return content
}

const ChildPageHeader = ({ name, children }: { name: string; children?: ReactNode }) => (
  <div className="space-y-2">
    <a href="#" className={backLinkClasses} onClick={(event) => event.preventDefault()}>
      <ArrowLeft aria-hidden="true" className="size-4" />
      Back to children
    </a>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">{name}</h1>
      {children}
    </div>
  </div>
)

const DetailField = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="space-y-1">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="text-sm text-foreground">{children}</dd>
  </div>
)

const OverallGradeSelect = ({
  id,
  value,
  onChange,
}: {
  id: string
  value: number | null
  onChange: (grade: number | null) => void
}) => (
  <Select
    id={id}
    value={value === null ? NO_GRADE : String(value)}
    onChange={(event) => onChange(event.target.value === NO_GRADE ? null : Number(event.target.value))}
  >
    <option value={NO_GRADE}>Grade not set</option>
    {GRADE_VALUES.map((grade) => (
      <option key={grade} value={grade}>
        {formatOverallGrade(grade)}
      </option>
    ))}
  </Select>
)

const LevelSelect = ({
  id,
  value,
  onChange,
  label,
}: {
  id?: string
  value: number
  onChange: (level: number) => void
  label: string
}) => (
  <Select id={id} aria-label={label} value={value} onChange={(event) => onChange(Number(event.target.value))}>
    {GRADE_VALUES.map((level) => (
      <option key={level} value={level}>
        {formatLevel(level)}
      </option>
    ))}
  </Select>
)

const SubjectName = ({ subjectId }: { subjectId: string }) => {
  const subject = findSubject(subjectId)
  return (
    <span className={cn(!subject.isActive && 'text-muted-foreground')}>
      {subject.name}
      {!subject.isActive && <span className="ml-1.5 text-xs">(inactive subject)</span>}
    </span>
  )
}

const evaluatedLabel = (child: PrototypeChild): string =>
  child.evaluated === null ? 'Not evaluated' : `Evaluated by ${child.evaluated.by}, ${child.evaluated.on}`

const ClearEvaluatedButton = ({ evaluation, size = 'sm' }: VariantProps & { size?: 'sm' | 'lg' }) => {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  return (
    <>
      <Button type="button" variant="outline" size={size} onClick={() => setIsConfirmOpen(true)}>
        Clear evaluated
      </Button>
      <ConfirmDialog
        open={isConfirmOpen}
        onOpenChange={setIsConfirmOpen}
        title="Clear evaluated"
        body={`${evaluation.child.name}'s Subject levels stay. Until a Staff member marks Evaluated again, the bot sends any booking to the office as the evaluation session.`}
        confirmLabel="Clear evaluated"
        onConfirm={() => {
          evaluation.clearEvaluated()
          setIsConfirmOpen(false)
        }}
      />
    </>
  )
}

// --- Variant A: inline section on the existing child detail page -------------------------

const ChildVariantA = ({ evaluation }: VariantProps) => {
  const { child } = evaluation
  const [newSubjectId, setNewSubjectId] = useState('')
  const [newLevel, setNewLevel] = useState(0)

  const addableSubjects = evaluation.subjectsWithoutLevel
  const selectedNewSubject = newSubjectId || addableSubjects[0]?.id || ''

  const columns: Column<PrototypeSubjectLevel>[] = [
    { id: 'subject', header: 'Subject', cell: (row) => <SubjectName subjectId={row.subjectId} /> },
    {
      id: 'level',
      header: 'Subject level',
      cell: (row) => (
        <div className="w-24">
          <LevelSelect
            label={`${findSubject(row.subjectId).name} level`}
            value={row.level}
            onChange={(level) => evaluation.setLevel(row.subjectId, level)}
          />
        </div>
      ),
    },
    { id: 'setBy', header: 'Set by', cell: (row) => row.setBy },
    {
      id: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (row) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={evaluation.isLastLevelLocked}
          title={evaluation.isLastLevelLocked ? LAST_LEVEL_REASON : undefined}
          onClick={() => evaluation.removeLevel(row.subjectId)}
        >
          Remove
        </Button>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <ChildPageHeader name={child.name} />

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardAction>
            <Button type="button" size="sm">
              Edit
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <DetailField label="Date of birth">Mar 14, 2015 (11 years)</DetailField>
            <DetailField label={OVERALL_GRADE_LABEL}>
              {formatOverallGrade(child.overallGrade)}
              <span className="block text-xs text-muted-foreground">{OVERALL_GRADE_HINT}</span>
            </DetailField>
            <DetailField label="School">Coral Way K-8</DetailField>
            <DetailField label="Notes">—</DetailField>
          </dl>
        </CardContent>
      </Card>

      <section aria-labelledby="evaluation-heading" className="space-y-3">
        <h2 id="evaluation-heading" className="font-heading text-lg font-semibold tracking-tight">
          Evaluation
        </h2>

        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2">
              {child.evaluated ? (
                <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 text-primary" />
              ) : (
                <AlertCircle aria-hidden="true" className="mt-0.5 size-4 text-muted-foreground" />
              )}
              <div className="space-y-0.5">
                <p className="text-sm font-medium">{evaluatedLabel(child)}</p>
                {child.evaluated === null && (
                  <p className="text-sm text-muted-foreground">
                    The bot sends any booking for {child.name.split(' ')[0]} to the office as the
                    evaluation session.
                  </p>
                )}
              </div>
            </div>
            {child.evaluated ? (
              <ClearEvaluatedButton evaluation={evaluation} />
            ) : (
              <div className="flex flex-col items-end gap-1">
                <Button
                  type="button"
                  size="sm"
                  disabled={!evaluation.canMarkEvaluated}
                  onClick={evaluation.markEvaluated}
                >
                  Mark evaluated
                </Button>
                {!evaluation.canMarkEvaluated && (
                  <span className="text-xs text-muted-foreground">{MARK_NEEDS_LEVEL_REASON}</span>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <DataTable
          caption="Subject levels"
          columns={columns}
          rows={child.levels}
          rowKey={(row) => row.subjectId}
          status="ready"
          emptyMessage="No Subject levels yet."
        />
        {evaluation.isLastLevelLocked && (
          <p className="text-xs text-muted-foreground">{LAST_LEVEL_REASON}</p>
        )}

        {addableSubjects.length > 0 && (
          <Card size="sm">
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-40 space-y-1.5">
                  <Label htmlFor="add-level-subject">Subject</Label>
                  <Select
                    id="add-level-subject"
                    value={selectedNewSubject}
                    onChange={(event) => setNewSubjectId(event.target.value)}
                  >
                    {addableSubjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="w-24 space-y-1.5">
                  <Label htmlFor="add-level-value">Level</Label>
                  <LevelSelect id="add-level-value" label="Level" value={newLevel} onChange={setNewLevel} />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    evaluation.setLevel(selectedNewSubject, newLevel)
                    setNewSubjectId('')
                  }}
                >
                  Add level
                </Button>
              </div>
              <ul className="space-y-1">
                {addableSubjects.map((subject) => (
                  <li key={subject.id} className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{subject.name}</span> · {NO_LEVEL_CONSEQUENCE}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  )
}

// --- Variant B: compact read-only summary + "Evaluate" slide-over -----------------------

const ChildVariantB = ({ evaluation }: VariantProps) => {
  const { child } = evaluation
  const [isEvaluateOpen, setIsEvaluateOpen] = useState(false)

  return (
    <div className="space-y-6">
      <ChildPageHeader name={child.name} />

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardAction>
            <Button type="button" size="sm" variant="outline">
              Edit
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <DetailField label="Date of birth">Mar 14, 2015 (11 years)</DetailField>
            <DetailField label="School">Coral Way K-8</DetailField>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Evaluation</CardTitle>
          <CardAction>
            <Button type="button" size="sm" onClick={() => setIsEvaluateOpen(true)}>
              {child.evaluated ? 'Edit evaluation' : 'Evaluate'}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <p
            className={cn(
              'text-sm',
              child.evaluated ? 'text-foreground' : 'font-medium text-foreground',
            )}
          >
            {evaluatedLabel(child)}
            {child.evaluated === null && (
              <span className="block font-normal text-muted-foreground">{NOT_EVALUATED_CONSEQUENCE}</span>
            )}
          </p>
          <dl className="grid gap-4 sm:grid-cols-2">
            <DetailField label={OVERALL_GRADE_LABEL}>{formatOverallGrade(child.overallGrade)}</DetailField>
            <DetailField label="Subject levels">
              {child.levels.length === 0 ? (
                'None yet'
              ) : (
                <span className="flex flex-wrap gap-x-3 gap-y-1">
                  {child.levels.map((level) => (
                    <span key={level.subjectId} title={`Set by ${level.setBy}`}>
                      <SubjectName subjectId={level.subjectId} />{' '}
                      <span className="font-medium tabular-nums">{formatLevel(level.level)}</span>
                    </span>
                  ))}
                </span>
              )}
            </DetailField>
          </dl>
          {evaluation.subjectsWithoutLevel.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Office handles bookings for: {evaluation.subjectsWithoutLevel.map((s) => s.name).join(', ')} (no level).
            </p>
          )}
        </CardContent>
      </Card>

      {isEvaluateOpen && (
        <EvaluateSlideOver
          child={child}
          onClose={() => setIsEvaluateOpen(false)}
          onSave={(next) => {
            evaluation.replaceChild(next)
            setIsEvaluateOpen(false)
          }}
        />
      )}
    </div>
  )
}

const EvaluateSlideOver = ({
  child,
  onClose,
  onSave,
}: {
  child: PrototypeChild
  onClose: () => void
  onSave: (child: PrototypeChild) => void
}) => {
  // A second, draft copy of the same rules: nothing applies until Save.
  const draft = useChildEvaluationPrototype(child, false)
  const [newSubjectId, setNewSubjectId] = useState('')
  const addable = draft.subjectsWithoutLevel
  const selectedNewSubject = newSubjectId || addable[0]?.id || ''

  return (
    <SlideOver
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Evaluate ${child.name}`}
      description="Overall grade, Subject levels and the Evaluated mark save together."
      footer={
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={() => onSave(draft.child)}>
            Save evaluation
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="space-y-1.5">
          <Label htmlFor="evaluate-grade">{OVERALL_GRADE_LABEL}</Label>
          <OverallGradeSelect id="evaluate-grade" value={draft.child.overallGrade} onChange={draft.setOverallGrade} />
          <p className="text-xs text-muted-foreground">{OVERALL_GRADE_HINT}</p>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Subject levels</legend>
          {draft.child.levels.length === 0 && (
            <p className="text-sm text-muted-foreground">No Subject levels yet.</p>
          )}
          <ul className="space-y-2">
            {draft.child.levels.map((level) => (
              <li key={level.subjectId} className="flex items-center gap-3">
                <span className="flex-1 text-sm">
                  <SubjectName subjectId={level.subjectId} />
                  <span className="block text-xs text-muted-foreground">Set by {level.setBy}</span>
                </span>
                <div className="w-20">
                  <LevelSelect
                    label={`${findSubject(level.subjectId).name} level`}
                    value={level.level}
                    onChange={(value) => draft.setLevel(level.subjectId, value)}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${findSubject(level.subjectId).name} level`}
                  disabled={draft.isLastLevelLocked}
                  title={draft.isLastLevelLocked ? LAST_LEVEL_REASON : undefined}
                  onClick={() => draft.removeLevel(level.subjectId)}
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
          {draft.isLastLevelLocked && <p className="text-xs text-muted-foreground">{LAST_LEVEL_REASON}</p>}
          {addable.length > 0 && (
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <Select
                  aria-label="Subject to add"
                  value={selectedNewSubject}
                  onChange={(event) => setNewSubjectId(event.target.value)}
                >
                  {addable.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name} (office handles today)
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  draft.setLevel(selectedNewSubject, 0)
                  setNewSubjectId('')
                }}
              >
                Add level
              </Button>
            </div>
          )}
          {addable.length > 0 && <p className="text-xs text-muted-foreground">{NO_LEVEL_CONSEQUENCE}</p>}
        </fieldset>

        <div className="space-y-1.5 rounded-lg border border-border p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={draft.child.evaluated !== null}
              disabled={!draft.canMarkEvaluated && draft.child.evaluated === null}
              onChange={(event) => (event.target.checked ? draft.markEvaluated() : draft.clearEvaluated())}
            />
            Evaluated
          </label>
          <p className="text-xs text-muted-foreground">
            {draft.child.evaluated
              ? `${evaluatedLabel(draft.child)}. Unticking keeps the levels.`
              : draft.canMarkEvaluated
                ? NOT_EVALUATED_CONSEQUENCE
                : MARK_NEEDS_LEVEL_REASON}
          </p>
        </div>
      </div>
    </SlideOver>
  )
}

// --- Variant C: subject-by-subject matrix, Evaluated as the primary action ---------------

const OFFICE_KEY = 'office'

const ChildVariantC = ({ evaluation }: VariantProps) => {
  const { child } = evaluation
  // Every active subject is a row; a level on a deactivated subject stays as a muted row.
  const orderedSubjectIds = [
    ...ACTIVE_SUBJECTS.map((subject) => subject.id),
    ...child.levels
      .filter((level) => !findSubject(level.subjectId).isActive)
      .map((level) => level.subjectId),
  ]

  return (
    <div className="space-y-6">
      <ChildPageHeader name={child.name} />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-6">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-heading text-lg font-semibold tracking-tight">{evaluatedLabel(child)}</p>
            <p className="text-sm text-muted-foreground">
              {child.evaluated
                ? 'The bot books subjects that have a level and hands the rest to the office.'
                : NOT_EVALUATED_CONSEQUENCE}
            </p>
          </div>
          <div className="w-48 space-y-1.5">
            <Label htmlFor="matrix-grade">{OVERALL_GRADE_LABEL}</Label>
            <OverallGradeSelect id="matrix-grade" value={child.overallGrade} onChange={evaluation.setOverallGrade} />
          </div>
          {child.evaluated ? (
            <ClearEvaluatedButton evaluation={evaluation} size="lg" />
          ) : (
            <div className="flex flex-col items-start gap-1">
              <Button type="button" size="lg" disabled={!evaluation.canMarkEvaluated} onClick={evaluation.markEvaluated}>
                <CheckCircle2 />
                Mark evaluated
              </Button>
              {!evaluation.canMarkEvaluated && (
                <span className="text-xs text-muted-foreground">{MARK_NEEDS_LEVEL_REASON}</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="py-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Subject levels by subject</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-2 text-start text-xs font-medium text-muted-foreground">
                  Subject
                </th>
                <th scope="col" className="px-1 py-2 text-xs font-medium text-muted-foreground">
                  Office
                </th>
                {GRADE_VALUES.map((level) => (
                  <th key={level} scope="col" className="px-0.5 py-2 text-xs font-medium text-muted-foreground">
                    {formatLevel(level)}
                  </th>
                ))}
                <th scope="col" className="px-4 py-2 text-start text-xs font-medium text-muted-foreground">
                  Set by
                </th>
              </tr>
            </thead>
            <tbody>
              {orderedSubjectIds.map((subjectId) => {
                const subject = findSubject(subjectId)
                const current = evaluation.levelFor(subjectId)
                const selected = current === undefined ? OFFICE_KEY : String(current.level)
                const isOfficeLocked = current !== undefined && evaluation.isLastLevelLocked
                return (
                  <tr
                    key={subjectId}
                    className={cn('border-b border-border last:border-b-0', !subject.isActive && 'opacity-60')}
                  >
                    <th scope="row" className="px-4 py-2 text-start font-medium whitespace-nowrap">
                      <SubjectName subjectId={subjectId} />
                    </th>
                    <td className="px-1 py-2 text-center">
                      <MatrixCell
                        label="Office"
                        isSelected={selected === OFFICE_KEY}
                        disabled={isOfficeLocked}
                        title={isOfficeLocked ? LAST_LEVEL_REASON : NO_LEVEL_CONSEQUENCE}
                        onClick={() => evaluation.removeLevel(subjectId)}
                        isWide
                      />
                    </td>
                    {GRADE_VALUES.map((level) => (
                      <td key={level} className="px-0.5 py-2 text-center">
                        <MatrixCell
                          label={formatLevel(level)}
                          isSelected={selected === String(level)}
                          title={`${subject.name} level ${formatLevel(level)}`}
                          onClick={() => evaluation.setLevel(subjectId, level)}
                        />
                      </td>
                    ))}
                    <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                      {current ? current.setBy : 'Office handles bookings'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-xs text-muted-foreground">
        Office = no level: the bot hands bookings for that subject to the office.
        {evaluation.isLastLevelLocked && ` ${LAST_LEVEL_REASON}`}
      </p>
    </div>
  )
}

const MatrixCell = ({
  label,
  isSelected,
  disabled = false,
  title,
  onClick,
  isWide = false,
}: {
  label: string
  isSelected: boolean
  disabled?: boolean
  title: string
  onClick: () => void
  isWide?: boolean
}) => (
  <button
    type="button"
    aria-pressed={isSelected}
    disabled={disabled}
    title={title}
    onClick={onClick}
    className={cn(
      'inline-flex h-8 items-center justify-center rounded-lg text-xs font-medium tabular-nums transition-colors',
      'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50',
      isWide ? 'px-2' : 'w-8',
      isSelected ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
    )}
  >
    {label}
  </button>
)
