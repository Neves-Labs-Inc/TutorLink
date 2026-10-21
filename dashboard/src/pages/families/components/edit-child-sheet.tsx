// Edit details: name, date of birth, Overall grade, school and Child
// notes. Mount a fresh instance per open (key) so it starts from the
// Child as saved. The fields stand in for ticket 03's ChildFields; swap
// them in once it lands.
import { useId } from "react";
import type { FormEvent, ReactNode } from "react";
import { Button } from "@/components/kit/components/button";
import {
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/kit/components/fields";
import type { SelectOption } from "@/components/kit/components/fields";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import { gradeName, HIGHEST_GRADE, LOWEST_GRADE } from "@/lib/grades/grades";
import SheetFailureLine from "@/pages/families/components/sheet-failure-line";
import { useEditChild } from "@/pages/families/hooks/use-edit-child";
import type { ChildDetail } from "@/types/families";

const NOTES_MAX_LENGTH = 2000;
const NOT_SET: SelectOption = { value: "", label: "Not set" };
const GRADE_OPTIONS: SelectOption[] = Array.from(
  { length: HIGHEST_GRADE - LOWEST_GRADE + 1 },
  (_, index) => ({
    value: String(LOWEST_GRADE + index),
    label: gradeName(LOWEST_GRADE + index),
  }),
);

type EditChildSheetProps = {
  child: ChildDetail;
  isOpen: boolean;
  onClose: () => void;
};

export default function EditChildSheet({
  child,
  isOpen,
  onClose,
}: EditChildSheetProps): ReactNode {
  const formId = useId();
  const edit = useEditChild(child, onClose);
  const { form, errors } = edit;
  // The API can't clear a grade, so Not set is only there until one is.
  const gradeOptions =
    child.grade_level === null ? [NOT_SET, ...GRADE_OPTIONS] : GRADE_OPTIONS;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void edit.save();
  }

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title="Edit details"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            isLoading={edit.isSaving}
          >
            Save details
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={handleSubmit}
        className="flex flex-col gap-5"
      >
        <TextField
          label="Name"
          required
          autoComplete="off"
          value={form.name}
          error={errors.name}
          onChange={(event) => edit.setField("name", event.target.value)}
        />
        <div className="grid gap-5 @md:grid-cols-2">
          <TextField
            label="Date of birth"
            type="date"
            value={form.dateOfBirth}
            error={errors.dateOfBirth}
            onChange={(event) => edit.setField("dateOfBirth", event.target.value)}
          />
          <SelectField
            label="Overall grade"
            help="The Guardian’s estimate. Not used to match Tutors."
            options={gradeOptions}
            value={form.grade}
            onValueChange={(value) => edit.setField("grade", value)}
          />
        </div>
        <TextField
          label="School"
          autoComplete="off"
          value={form.school}
          onChange={(event) => edit.setField("school", event.target.value)}
        />
        <TextAreaField
          label="Child notes"
          help="Tutors see these with each Session: needs, allergies, how to approach sessions."
          rows={3}
          maxLength={NOTES_MAX_LENGTH}
          value={form.notes}
          onChange={(event) => edit.setField("notes", event.target.value)}
        />
        {errors.form && <SheetFailureLine message={errors.form} />}
      </form>
    </BottomSheet>
  );
}
