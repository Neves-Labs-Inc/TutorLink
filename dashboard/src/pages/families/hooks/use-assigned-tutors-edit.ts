// The Assigned Tutors edit sheet's form: the picker prefilled with the
// Child's Tutors, saved as a diff (adds, then removes). Saving none
// needs no confirm (DESIGN §11.6): it toasts with an Undo that re-adds
// them. Mount a fresh instance per open (key).
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/components/kit/overlays/use-toast";
import { getFirstName } from "@/lib/families/child-labels";
import { planAssignedTutors } from "@/lib/families/assigned-tutors";
import {
  assignedTutorMutations,
  assignedTutorQueries,
  AssignedTutorsSaveError,
} from "@/lib/queries/assigned-tutors";
import type { ChildDetail } from "@/types/families";

const SAVE_FAILED =
  "Couldn’t save Assigned Tutors. Check your connection and try again.";
const PARTLY_SAVED = "Saved some changes, but not all. Check the list and try again.";

export type AssignedTutorsEdit = {
  selected: string[];
  setSelected: (ids: string[]) => void;
  failure: string | null;
  isSaving: boolean;
  save: () => Promise<void>;
};

function hasApplied(error: unknown): boolean {
  return (
    error instanceof AssignedTutorsSaveError &&
    error.applied.add.length + error.applied.remove.length > 0
  );
}

export function useAssignedTutorsEdit(
  child: ChildDetail,
  onSaved: () => void,
): AssignedTutorsEdit {
  const { showToast } = useToast();
  const assignable = useQuery(assignedTutorQueries.assignable());
  const saveMutation = useMutation(assignedTutorMutations.save());
  const undoMutation = useMutation(assignedTutorMutations.save());
  const [selected, setSelected] = useState(() =>
    child.assigned_tutors.map((tutor) => tutor.id),
  );
  const [failure, setFailure] = useState<string | null>(null);
  const first = getFirstName(child.name);
  // Someone archived (or made an Admin) since they were ticked drops out
  // of the picker; sending them would 422 on every retry.
  const pickedIds = assignable.data
    ? selected.filter((id) => assignable.data.some((person) => person.id === id))
    : selected;

  function undoNone(removedIds: string[]): void {
    undoMutation
      .mutateAsync({ childId: child.id, currentIds: [], wantedIds: removedIds })
      .catch(() => {
        showToast({
          tone: "error",
          message: `Couldn’t undo. ${first} still has no Assigned Tutors.`,
        });
      });
  }

  async function save(): Promise<void> {
    // From the Child as it is now: a part-way save reloaded it.
    const currentIds = child.assigned_tutors.map((tutor) => tutor.id);
    const plan = planAssignedTutors(currentIds, pickedIds);
    setFailure(null);
    if (plan.add.length + plan.remove.length === 0) {
      onSaved();
      return;
    }

    try {
      await saveMutation.mutateAsync({
        childId: child.id,
        currentIds,
        wantedIds: pickedIds,
      });
    } catch (error) {
      setFailure(hasApplied(error) ? PARTLY_SAVED : SAVE_FAILED);
      return;
    }
    onSaved();
    if (pickedIds.length === 0) {
      showToast({
        tone: "success",
        message: `${first} has no Assigned Tutors now, so they’re in To do until you assign one.`,
        actionLabel: "Undo",
        onAction: () => undoNone(plan.remove),
      });
    } else {
      showToast({ tone: "success", message: "Assigned Tutors saved." });
    }
  }

  return {
    selected,
    setSelected,
    failure,
    isSaving: saveMutation.isPending,
    save,
  };
}
