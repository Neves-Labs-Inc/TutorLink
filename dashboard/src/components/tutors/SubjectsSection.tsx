import { useId, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { SlideOver } from '@/components/shared/SlideOver'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { errorDetail } from '@/lib/api'
import { HIGHEST_GRADE, LOWEST_GRADE, gradeName } from '@/lib/grades/grades'
import { subjectQueries } from '@/lib/queries/subjects'
import { assignSubject, removeSubject } from '@/lib/queries/tutorSubjects'
import { tutorQueries, type Tutor, type TutorSubject } from '@/lib/queries/tutors'
import { ceilingError } from '@/lib/tutors/tutors'

type SubjectsSectionProps = { tutorId: string }

type SubjectsCardProps = { tutor: Tutor }

const SAVE_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const SUBJECT_PAGE_SIZE = 100

export const SubjectsSection = ({ tutorId }: SubjectsSectionProps) => {
  const { data: tutor } = useQuery(tutorQueries.detail(tutorId))

  return tutor === undefined ? null : <SubjectsCard tutor={tutor} />
}

const SubjectsCard = ({ tutor }: SubjectsCardProps) => {
  const queryClient = useQueryClient()
  const formId = useId()
  const [addOpen, setAddOpen] = useState(false)
  const [subjectId, setSubjectId] = useState('')
  const [maxGradeLevel, setMaxGradeLevel] = useState('')
  const [isGradeChecked, setIsGradeChecked] = useState(false)
  const [pendingRemoval, setPendingRemoval] = useState<TutorSubject | null>(null)

  const subjects = useQuery({
    ...subjectQueries.list({ page_size: SUBJECT_PAGE_SIZE }),
    enabled: addOpen,
  })

  const assign = useMutation({
    mutationFn: () =>
      assignSubject(tutor.id, {
        subject_id: subjectId,
        max_grade_level: Number(maxGradeLevel),
      }),
    onSuccess: () => {
      setAddOpen(false)

      return queryClient.invalidateQueries({ queryKey: ['tutors'] })
    },
  })

  const remove = useMutation({
    mutationFn: (assignment: TutorSubject) => removeSubject(tutor.id, assignment.subject_id),
    onSuccess: () => {
      setPendingRemoval(null)

      return queryClient.invalidateQueries({ queryKey: ['tutors'] })
    },
  })

  const assignedIds = new Set(tutor.subjects.map((assignment) => assignment.subject_id))
  const available = (subjects.data?.items ?? []).filter((subject) => !assignedIds.has(subject.id))

  const handleAddOpenChange = (open: boolean) => {
    if (open) {
      setSubjectId('')
      setMaxGradeLevel('')
      setIsGradeChecked(false)
      assign.reset()
    }
    setAddOpen(open)
  }

  const handleRemoveOpenChange = (open: boolean) => {
    if (!open) {
      setPendingRemoval(null)
      remove.reset()
    }
  }

  const handleRemoveRequest = (assignment: TutorSubject) => {
    remove.reset()
    setPendingRemoval(assignment)
  }

  const handleRemoveConfirm = () => {
    if (pendingRemoval !== null) {
      remove.mutate(pendingRemoval)
    }
  }

  const gradeError = isGradeChecked ? ceilingError(maxGradeLevel) : null

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsGradeChecked(true)

    if (ceilingError(maxGradeLevel) === null) {
      assign.mutate()
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Subjects</CardTitle>
        <CardAction>
          <Button type="button" variant="outline" onClick={() => handleAddOpenChange(true)}>
            Add subject
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {tutor.subjects.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No subjects assigned yet. This tutor will not match any booking request.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {tutor.subjects.map((assignment) => (
              <li
                key={assignment.subject_id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-foreground">{assignment.name}</p>
                  <p className="text-sm text-muted-foreground">
                    Teaches up to {gradeName(assignment.max_grade_level)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => handleRemoveRequest(assignment)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <SlideOver
        open={addOpen}
        onOpenChange={handleAddOpenChange}
        title="Add subject"
        description="Pick a subject and the highest grade this tutor covers in it."
        footer={
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={assign.isPending}
              onClick={() => handleAddOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form={formId}
              disabled={assign.isPending || available.length === 0}
            >
              {assign.isPending ? 'Adding…' : 'Add subject'}
            </Button>
          </div>
        }
      >
        <form id={formId} onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-subject`}>Subject</Label>
            <Select
              id={`${formId}-subject`}
              name="subject_id"
              required
              value={subjectId}
              disabled={assign.isPending || subjects.isPending}
              onChange={(event) => setSubjectId(event.target.value)}
            >
              <option value="" disabled>
                Select a subject…
              </option>
              {available.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </Select>
            {subjects.isError && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {errorDetail(subjects.error) ?? SAVE_FALLBACK_ERROR}
              </p>
            )}
            {subjects.isSuccess && available.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Every active subject is already assigned to this tutor.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-grade`}>Highest grade taught</Label>
            <Input
              id={`${formId}-grade`}
              name="max_grade_level"
              type="number"
              min={LOWEST_GRADE}
              max={HIGHEST_GRADE}
              step={1}
              required
              inputMode="numeric"
              autoComplete="off"
              aria-invalid={gradeError !== null || undefined}
              aria-describedby={`${formId}-grade-hint`}
              value={maxGradeLevel}
              disabled={assign.isPending}
              onChange={(event) => setMaxGradeLevel(event.target.value)}
            />
            <p id={`${formId}-grade-hint`} className="text-sm text-muted-foreground">
              A ceiling, not a single grade: entering 8 means this tutor covers grade 8 and every
              grade below it in this subject. Enter 0 for Kindergarten.
            </p>
            {gradeError !== null && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {gradeError}
              </p>
            )}
          </div>
          {assign.isError && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {errorDetail(assign.error) ?? SAVE_FALLBACK_ERROR}
            </p>
          )}
        </form>
      </SlideOver>

      <ConfirmDialog
        open={pendingRemoval !== null}
        onOpenChange={handleRemoveOpenChange}
        title="Remove subject"
        body={`${pendingRemoval?.name ?? ''} will no longer be matched to this tutor. Existing bookings are untouched.`}
        confirmLabel="Remove"
        destructive
        pending={remove.isPending}
        errorMessage={remove.isError ? (errorDetail(remove.error) ?? SAVE_FALLBACK_ERROR) : null}
        onConfirm={handleRemoveConfirm}
      />
    </Card>
  )
}
