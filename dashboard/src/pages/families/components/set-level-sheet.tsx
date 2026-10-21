// Set Subject level: one active Subject and the grade the Child works at
// in it. Mount a fresh instance per open (key).
import { useId } from "react";
import type { FormEvent, ReactNode } from "react";
import { Button } from "@/components/kit/components/button";
import { SelectField } from "@/components/kit/components/fields";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import { InlineError, Skeleton } from "@/components/kit/states/states";
import SheetFailureLine from "@/pages/families/components/sheet-failure-line";
import { useFirstFieldFocus } from "@/pages/families/hooks/use-first-field-focus";
import { useSetLevel } from "@/pages/families/hooks/use-set-level";
import type { SetLevel } from "@/pages/families/hooks/use-set-level";
import { SUNK_WELL } from "@/pages/families/lib/family-classes";
import { GRADE_OPTIONS } from "@/pages/families/lib/grade-options";
import type { ChildDetail } from "@/types/families";

// Kindergarten to Grade 12: a Subject level is never Not set.
const LEVEL_OPTIONS = GRADE_OPTIONS.filter((option) => option.value !== "");
const FIELD_SKELETONS = 2;
// A Select is a button.
const FIRST_SELECT = "[role=combobox]";

type SetLevelSheetProps = {
  child: ChildDetail;
  isOpen: boolean;
  onClose: () => void;
};

export default function SetLevelSheet({
  child,
  isOpen,
  onClose,
}: SetLevelSheetProps): ReactNode {
  const formId = useId();
  const setLevel = useSetLevel(child, onClose);
  const hasSubjects = (setLevel.subjects.data?.length ?? 0) > 0;
  const attachForm = useFirstFieldFocus(isOpen, {
    isReady: setLevel.subjects.isSuccess,
    selector: FIRST_SELECT,
  });

  function handleClose(): void {
    if (setLevel.isSaving) return;
    onClose();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void setLevel.save();
  }

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={handleClose}
      title="Set Subject level"
      footer={
        <>
          <Button onClick={handleClose} disabled={setLevel.isSaving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            isLoading={setLevel.isSaving}
            disabled={!hasSubjects}
          >
            Save level
          </Button>
        </>
      }
    >
      <form id={formId} ref={attachForm} noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
        <LevelFields setLevel={setLevel} />
        {setLevel.failure && <SheetFailureLine message={setLevel.failure} />}
      </form>
    </BottomSheet>
  );
}

type LevelFieldsProps = { setLevel: SetLevel };

function LevelFields({ setLevel }: LevelFieldsProps): ReactNode {
  const { subjects } = setLevel;
  let fields: ReactNode = (
    <div role="status" aria-label="Loading" className="grid gap-5 @md:grid-cols-2">
      {Array.from({ length: FIELD_SKELETONS }, (_, index) => (
        <Skeleton key={index} className="h-11 rounded-full" />
      ))}
    </div>
  );
  if (subjects.data && subjects.data.length === 0) {
    fields = <p className={SUNK_WELL}>No Subjects yet</p>;
  } else if (subjects.data) {
    fields = (
      <div className="grid gap-5 @md:grid-cols-2">
        <SelectField
          label="Subject"
          options={subjects.data.map((subject) => ({
            value: subject.id,
            label: subject.name,
          }))}
          value={setLevel.subjectId}
          onValueChange={setLevel.setSubject}
        />
        <SelectField
          label="Subject level"
          help={setLevel.help}
          options={LEVEL_OPTIONS}
          value={setLevel.level}
          onValueChange={setLevel.setLevel}
        />
      </div>
    );
  } else if (subjects.isError) {
    fields = (
      <InlineError
        message="Couldn’t load Subjects. Check your connection."
        onRetry={() => void subjects.refetch()}
        isRetrying={subjects.isFetching}
      />
    );
  }
  return fields;
}
