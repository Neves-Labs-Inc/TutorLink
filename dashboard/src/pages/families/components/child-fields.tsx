// The Child's own fields, shared by Add child (ticket 03) and the
// Child edit sheet (ticket 09): Name through Child notes.
import type { ReactNode } from "react";
import { SelectField, TextAreaField, TextField } from "@/components/kit/components/fields";
import { GRADE_OPTIONS } from "@/pages/families/lib/grade-options";

// The API's cap (models/child.py NOTES_MAX_LENGTH).
export const CHILD_NOTES_MAX = 2000;

export type ChildFieldValues = {
  name: string;
  dateOfBirth: string;
  grade: string;
  school: string;
  notes: string;
};

export type ChildFieldErrors = {
  name: string | null;
  dateOfBirth: string | null;
  notes: string | null;
};

type ChildFieldsProps = {
  value: ChildFieldValues;
  errors: ChildFieldErrors;
  onChange: (changes: Partial<ChildFieldValues>) => void;
  onBlur: () => void;
};

export default function ChildFields({
  value,
  errors,
  onChange,
  onBlur,
}: ChildFieldsProps): ReactNode {
  return (
    <>
      <TextField
        label="Name"
        required
        autoComplete="off"
        value={value.name}
        onChange={(event) => onChange({ name: event.target.value })}
        onBlur={onBlur}
        error={errors.name ?? undefined}
      />
      <div className="grid gap-5 @md:grid-cols-2">
        <TextField
          label="Date of birth"
          required
          type="date"
          value={value.dateOfBirth}
          onChange={(event) => onChange({ dateOfBirth: event.target.value })}
          onBlur={onBlur}
          error={errors.dateOfBirth ?? undefined}
        />
        <SelectField
          label="Overall grade"
          help="The Guardian’s estimate. Not used to match Tutors."
          options={GRADE_OPTIONS}
          value={value.grade}
          onValueChange={(grade) => onChange({ grade })}
        />
      </div>
      <TextField
        label="School"
        autoComplete="off"
        value={value.school}
        onChange={(event) => onChange({ school: event.target.value })}
      />
      <TextAreaField
        label="Child notes"
        help="Tutors see these with each Session."
        rows={3}
        maxLength={CHILD_NOTES_MAX}
        value={value.notes}
        onChange={(event) => onChange({ notes: event.target.value })}
        onBlur={onBlur}
        error={errors.notes ?? undefined}
      />
    </>
  );
}
