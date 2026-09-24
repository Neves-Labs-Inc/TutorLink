import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { ChildDraft } from '@/lib/children/children'
import { todayLocalIso } from '@/lib/dates/dates'

type ChildFieldsProps = {
  idPrefix: string
  value: ChildDraft
  onChange: (next: ChildDraft) => void
  disabled?: boolean
  today: Date
}

const NOTES_MAX_LENGTH = 2000

export const ChildFields = ({ idPrefix, value, onChange, disabled, today }: ChildFieldsProps) => (
  <div className="space-y-4">
    <div className="space-y-1.5">
      <Label htmlFor={`${idPrefix}-name`}>Name</Label>
      <Input
        id={`${idPrefix}-name`}
        value={value.name}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, name: event.target.value })}
      />
    </div>

    <div className="space-y-1.5">
      <Label htmlFor={`${idPrefix}-dob`}>Date of birth</Label>
      <Input
        id={`${idPrefix}-dob`}
        type="date"
        max={todayLocalIso(today)}
        value={value.dateOfBirth}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, dateOfBirth: event.target.value })}
      />
    </div>

    <div className="space-y-1.5">
      <Label htmlFor={`${idPrefix}-grade`}>Grade level</Label>
      <Input
        id={`${idPrefix}-grade`}
        type="number"
        min={1}
        value={value.gradeLevel}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, gradeLevel: event.target.value })}
      />
    </div>

    <div className="space-y-1.5">
      <Label htmlFor={`${idPrefix}-school`}>School</Label>
      <Input
        id={`${idPrefix}-school`}
        value={value.schoolName}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, schoolName: event.target.value })}
      />
    </div>

    <div className="space-y-1.5">
      <Label htmlFor={`${idPrefix}-notes`}>Notes (optional)</Label>
      <Textarea
        id={`${idPrefix}-notes`}
        rows={3}
        maxLength={NOTES_MAX_LENGTH}
        value={value.notes}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, notes: event.target.value })}
      />
      <p className="text-xs text-muted-foreground">
        These notes are for the office, not the tutor.
      </p>
    </div>
  </div>
)
