// Edit subjects (Overview's "Edit subjects", the checklist's "Add
// subjects"): one row per live Subject, ticked with its highest grade.
import type { ReactNode } from "react";
import { Button } from "@/components/kit/components/button";
import { CheckboxField } from "@/components/kit/components/choices";
import { SelectField } from "@/components/kit/components/fields";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import {
  FormAlert,
  InlineError,
  Skeleton,
} from "@/components/kit/states/states";
import type { SelectOption } from "@/components/kit/types/select";
import { gradeName, HIGHEST_GRADE, LOWEST_GRADE } from "@/lib/grades/grades";
import type { StaffRead } from "@/lib/queries/staff";
import { useSubjectsSheet } from "@/pages/staff/hooks/use-subjects-sheet";

const LOADING_ROWS = 5;

const GRADE_OPTIONS: SelectOption[] = Array.from(
  { length: HIGHEST_GRADE - LOWEST_GRADE + 1 },
  (_, index) => ({
    value: String(LOWEST_GRADE + index),
    label: gradeName(LOWEST_GRADE + index),
  }),
);

type SubjectsSheetProps = {
  isOpen: boolean;
  staff: StaffRead;
  onClose: () => void;
};

export default function SubjectsSheet({
  isOpen,
  staff,
  onClose,
}: SubjectsSheetProps): ReactNode {
  const sheet = useSubjectsSheet(staff, isOpen, onClose);

  let body: ReactNode;
  if (sheet.hasFailed) {
    body = (
      <InlineError
        message="Couldn’t load the Subjects. Check your connection and try again."
        onRetry={sheet.retry}
        isRetrying={sheet.isRetrying}
      />
    );
  } else if (!sheet.subjects) {
    body = (
      <div
        role="status"
        aria-label="Loading Subjects"
        className="flex flex-col gap-3"
      >
        {Array.from({ length: LOADING_ROWS }, (_, index) => (
          <Skeleton key={index} className="h-14 rounded-[16px]" />
        ))}
      </div>
    );
  } else if (sheet.subjects.length === 0) {
    body = (
      <p className="rounded-[16px] bg-(--tl-surface-sunk) px-4 py-3 text-[14px] text-(--tl-muted)">
        No Subjects to pick from yet.
      </p>
    );
  } else {
    body = (
      <ul className="flex flex-col gap-3">
        {sheet.subjects.map((subject) => {
          const grade = sheet.getGrade(subject.id);
          return (
            <li
              key={subject.id}
              className="flex flex-col gap-2 rounded-[16px] border border-(--tl-border) px-4 py-1 @md:flex-row @md:items-center @md:justify-between"
            >
              <CheckboxField
                label={subject.name}
                isChecked={grade !== null}
                onChange={(isChecked) => sheet.toggle(subject.id, isChecked)}
              />
              {grade !== null && (
                <div className="pb-2 @md:w-48 @md:shrink-0 @md:pb-0">
                  <SelectField
                    label={`${subject.name}: highest grade`}
                    isLabelHidden
                    options={GRADE_OPTIONS}
                    value={String(grade)}
                    onValueChange={(value) =>
                      sheet.setGrade(subject.id, Number(value))
                    }
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={sheet.close}
      title="Subjects"
      description="The bot only offers them for Children at or below each grade."
      footer={
        <>
          <Button onClick={sheet.close} disabled={sheet.isSaving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={sheet.save}
            isLoading={sheet.isSaving}
            disabled={!sheet.subjects?.length}
          >
            Save subjects
          </Button>
        </>
      }
    >
      <fieldset
        disabled={sheet.isSaving}
        className="flex min-w-0 flex-col gap-3 transition-opacity duration-150 disabled:opacity-60"
      >
        <legend className="sr-only">Subjects they teach</legend>
        {sheet.formError && <FormAlert tone="danger" title={sheet.formError} />}
        {body}
      </fieldset>
    </BottomSheet>
  );
}
