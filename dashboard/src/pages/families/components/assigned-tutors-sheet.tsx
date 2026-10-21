// Change a Child's Assigned Tutors after Mark Evaluated: the picker,
// prefilled, against the Child's saved Subject levels. Mount a fresh
// instance per open (key).
import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FormEvent, ReactNode } from "react";
import { AssignedTutorsPicker } from "@/components/families/assigned-tutors-picker";
import { Button } from "@/components/kit/components/button";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import { getFirstName } from "@/lib/families/child-labels";
import { assignedTutorQueries } from "@/lib/queries/assigned-tutors";
import SheetFailureLine from "@/pages/families/components/sheet-failure-line";
import { useAssignedTutorsEdit } from "@/pages/families/hooks/use-assigned-tutors-edit";
import { useFirstFieldFocus } from "@/pages/families/hooks/use-first-field-focus";
import type { ChildDetail } from "@/types/families";

type AssignedTutorsSheetProps = {
  child: ChildDetail;
  isOpen: boolean;
  onClose: () => void;
};

export default function AssignedTutorsSheet({
  child,
  isOpen,
  onClose,
}: AssignedTutorsSheetProps): ReactNode {
  const formId = useId();
  const edit = useAssignedTutorsEdit(child, onClose);
  // The picker loads its own list; focus its first checkbox once it's in.
  const assignable = useQuery(assignedTutorQueries.assignable());
  const attachForm = useFirstFieldFocus(isOpen, { isReady: assignable.isSuccess });
  const levels = child.levels.filter((level) => !level.archived);

  // A multi-request save must not half-apply without feedback.
  function handleClose(): void {
    if (edit.isSaving) return;
    onClose();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void edit.save();
  }

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={handleClose}
      title="Assigned Tutors"
      description={`Who the bot may book ${getFirstName(child.name)} with. Pick Tutors who cover their Subject levels.`}
      footer={
        <>
          <Button onClick={handleClose} disabled={edit.isSaving}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} isLoading={edit.isSaving}>
            Save Tutors
          </Button>
        </>
      }
    >
      <form
        id={formId}
        ref={attachForm}
        noValidate
        onSubmit={handleSubmit}
        className="flex flex-col gap-5"
      >
        <AssignedTutorsPicker
          levels={levels}
          selected={edit.selected}
          onChange={edit.setSelected}
        />
        {edit.failure && <SheetFailureLine message={edit.failure} />}
      </form>
    </BottomSheet>
  );
}
