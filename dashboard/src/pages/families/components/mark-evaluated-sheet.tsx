// Mark Evaluated: what the Evaluation session found (a level per active
// Subject) and who teaches the Child (the first Assigned Tutors). Only
// an Evaluated Child can be booked through the bot. Mount a fresh
// instance per open (key).
import { useId } from "react";
import type { FormEvent, ReactNode } from "react";
import { BadgeCheck } from "lucide-react";
import { AssignedTutorsPicker } from "@/components/families/assigned-tutors-picker";
import { Button } from "@/components/kit/components/button";
import { SelectField } from "@/components/kit/components/fields";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import { InlineError, Skeleton } from "@/components/kit/states/states";
import { EYEBROW } from "@/components/kit/tokens";
import { getFirstName } from "@/lib/families/child-labels";
import { gradeName } from "@/lib/grades/grades";
import SheetFailureLine from "@/pages/families/components/sheet-failure-line";
import { useFirstFieldFocus } from "@/pages/families/hooks/use-first-field-focus";
import { useMarkEvaluated } from "@/pages/families/hooks/use-mark-evaluated";
import type { MarkEvaluated } from "@/pages/families/hooks/use-mark-evaluated";
import { GRADE_OPTIONS } from "@/pages/families/lib/grade-options";
import { SUNK_WELL } from "@/pages/families/lib/family-classes";
import type { ChildDetail } from "@/types/families";

const FIELD_SKELETONS = 3;
// A Select is a button.
const FIRST_SELECT = "[role=combobox]";
const ERROR_LINE = "px-1 text-[13px] font-medium text-(--tl-danger)";

type MarkEvaluatedSheetProps = {
  child: ChildDetail;
  isOpen: boolean;
  onClose: () => void;
};

export default function MarkEvaluatedSheet({
  child,
  isOpen,
  onClose,
}: MarkEvaluatedSheetProps): ReactNode {
  const formId = useId();
  const levelsId = useId();
  const tutorsId = useId();
  const mark = useMarkEvaluated(child, onClose);
  const attachForm = useFirstFieldFocus(isOpen, {
    isReady: mark.subjects.isSuccess,
    selector: FIRST_SELECT,
  });
  const first = getFirstName(child.name);

  // A multi-request save must not half-apply without feedback.
  function handleClose(): void {
    if (mark.isSaving) return;
    onClose();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void mark.save();
  }

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={handleClose}
      title="Mark Evaluated"
      description={`What the Evaluation session found, and who teaches ${first}. Only an Evaluated Child can be booked through the bot.`}
      footer={
        <>
          <Button onClick={handleClose} disabled={mark.isSaving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            icon={BadgeCheck}
            isLoading={mark.isSaving}
            disabled={!mark.subjects.isSuccess}
          >
            Mark Evaluated
          </Button>
        </>
      }
    >
      <form
        id={formId}
        ref={attachForm}
        noValidate
        onSubmit={handleSubmit}
        className="flex flex-col gap-6"
      >
        <section aria-labelledby={levelsId} className="flex flex-col gap-3">
          <h3 id={levelsId} className={EYEBROW}>
            Subject levels
          </h3>
          <LevelFields mark={mark} />
          {mark.levelError ? (
            <p role="alert" className={ERROR_LINE}>
              {mark.levelError}
            </p>
          ) : (
            <p className="px-1 text-[13px] text-(--tl-muted)">
              The grade {first} works at in each Subject
              {child.grade_level !== null && ` (overall: ${gradeName(child.grade_level)})`}
              . Leave the rest Not set.
            </p>
          )}
        </section>
        <section aria-labelledby={tutorsId} className="flex flex-col gap-2">
          <h3 id={tutorsId} className={EYEBROW}>
            Assigned Tutors
          </h3>
          <p className="text-[14px] leading-5 text-(--tl-ink-soft)">{mark.runnerNote}</p>
          <AssignedTutorsPicker
            levels={mark.levels}
            selected={mark.selected}
            onChange={mark.setSelected}
            error={mark.tutorError}
          />
        </section>
        {mark.failure && <SheetFailureLine message={mark.failure} />}
      </form>
    </BottomSheet>
  );
}

type LevelFieldsProps = { mark: MarkEvaluated };

function LevelFields({ mark }: LevelFieldsProps): ReactNode {
  const { subjects } = mark;
  let fields: ReactNode = (
    <div role="status" aria-label="Loading" className="grid gap-4 @md:grid-cols-2">
      {Array.from({ length: FIELD_SKELETONS }, (_, index) => (
        <Skeleton key={index} className="h-11 rounded-full" />
      ))}
    </div>
  );
  if (subjects.data && subjects.data.length === 0) {
    fields = <p className={SUNK_WELL}>No Subjects yet</p>;
  } else if (subjects.data) {
    fields = (
      <div className="grid gap-4 @md:grid-cols-2">
        {subjects.data.map((subject) => (
          <SelectField
            key={subject.id}
            label={subject.name}
            options={GRADE_OPTIONS}
            value={mark.getGrade(subject.id)}
            onValueChange={(value) => mark.setGrade(subject.id, value)}
          />
        ))}
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
