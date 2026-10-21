// The Change sheet's state: which live Evaluated Children are ticked, the
// search, and the save. A save applies at once (no confirm); leaving a
// Child with no Assigned Tutor offers Undo instead (DESIGN.md §11.6).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/kit/overlays/use-toast";
import {
  assignedChildrenQueries,
  refreshAssignedChildren,
  saveChildTutorsChanges,
} from "@/lib/queries/assigned-children";
import type {
  ChildTutorsChange,
  EvaluatedChild,
} from "@/lib/queries/assigned-children";
import type { StaffRead } from "@/lib/queries/staff";
import {
  describeLeftWithoutTutor,
  getFirstName,
  isAssignedTo,
  planChildrenChanges,
} from "@/pages/staff/lib/assigned-children";

const UNDO_FAILED =
  "Couldn’t undo it. Check the Children and try again.";

type AssignedChildrenSheet = {
  // Undefined until the first load.
  candidates: EvaluatedChild[] | undefined;
  matches: EvaluatedChild[];
  hasFailed: boolean;
  isRetrying: boolean;
  retry: () => void;
  search: string;
  setSearch: (search: string) => void;
  isSelected: (childId: string) => boolean;
  toggle: (childId: string, isChecked: boolean) => void;
  isSaving: boolean;
  hasPartlyFailed: boolean;
  save: () => void;
  close: () => void;
};

function matchesSearch(child: EvaluatedChild, needle: string): boolean {
  return (
    child.name.toLowerCase().includes(needle) ||
    child.guardians.some((guardian) =>
      guardian.name.toLowerCase().includes(needle),
    )
  );
}

function reverse(changes: ChildTutorsChange[]): ChildTutorsChange[] {
  return changes.map((change) => ({
    childId: change.childId,
    currentIds: change.wantedIds,
    wantedIds: change.currentIds,
  }));
}

export function useAssignedChildrenSheet(
  staff: StaffRead,
  onClose: () => void,
): AssignedChildrenSheet {
  const client = useQueryClient();
  const { showToast } = useToast();
  const query = useQuery(assignedChildrenQueries.evaluated());
  const candidates = query.data?.filter((child) => !child.archived);
  // Only the boxes the user changed; every other tick follows the server,
  // so a refetch mid-edit can't drop an assignment made elsewhere.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [hasPartlyFailed, setHasPartlyFailed] = useState(false);
  const mutation = useMutation({
    mutationFn: saveChildTutorsChanges,
    // A part-way failure changed the server too; awaited, so the ticks
    // re-seed from fresh data.
    onSettled: () => refreshAssignedChildren(client),
  });

  const selected = (candidates ?? [])
    .filter((child) => overrides[child.id] ?? isAssignedTo(child, staff.id))
    .map((child) => child.id);
  const needle = search.trim().toLowerCase();
  const matches = (candidates ?? []).filter((child) =>
    matchesSearch(child, needle),
  );
  const first = getFirstName(staff.name);

  async function undo(changes: ChildTutorsChange[]): Promise<void> {
    try {
      await saveChildTutorsChanges(reverse(changes));
    } catch {
      showToast({ tone: "error", message: UNDO_FAILED });
    } finally {
      await refreshAssignedChildren(client);
    }
  }

  function save(): void {
    const changes = planChildrenChanges(candidates ?? [], staff.id, selected);
    if (changes.length === 0) {
      onClose();
      return;
    }
    const leftMessage = describeLeftWithoutTutor(candidates ?? [], changes);
    setHasPartlyFailed(false);
    mutation.mutate(changes, {
      onSuccess: () => {
        onClose();
        showToast(
          leftMessage
            ? {
                tone: "success",
                message: leftMessage,
                actionLabel: "Undo",
                onAction: () => void undo(changes),
              }
            : { tone: "success", message: `${first}’s Children saved.` },
        );
      },
      onError: () => {
        setHasPartlyFailed(true);
        setOverrides({});
      },
    });
  }

  function toggle(childId: string, isChecked: boolean): void {
    setOverrides((current) => ({ ...current, [childId]: isChecked }));
  }

  return {
    candidates,
    matches,
    hasFailed: !candidates && (query.isError || query.errorUpdateCount > 0),
    isRetrying: query.isFetching,
    retry: () => void query.refetch(),
    search,
    setSearch,
    isSelected: (childId) => selected.includes(childId),
    toggle,
    isSaving: mutation.isPending,
    hasPartlyFailed,
    save,
    // Closing mid-save would hide whether it worked.
    close: () => {
      if (!mutation.isPending) onClose();
    },
  };
}
