// Change guardians: link an active Guardian (POST …/guardians; one from
// another family merges the two) or unlink one (PATCH guardian_ids
// without them). Unlinking is instant, with an Undo toast that re-links;
// unlinking the Guardian the page is opened from moves the page to the
// Child's remaining family.
// A Child always keeps one Guardian.
import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { Location } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { useToast } from "@/components/kit/overlays/use-toast";
import { errorStatus } from "@/lib/api";
import { familyPath } from "@/lib/families/family-paths";
import {
  familyMutations,
  familyQueries,
  refreshFamilies,
} from "@/lib/queries/families";
import type {
  ChildDetail,
  ChildGuardianRead,
  ClientSummary,
} from "@/types/families";

const CONFLICT = 409;

export type ChildGuardians = {
  candidates: UseQueryResult<ClientSummary[]>;
  // Active Guardians not already linked.
  options: ClientSummary[];
  pickedId: string | null;
  failure: string | null;
  isLinking: boolean;
  // A link or unlink in flight; the next write would start from a stale list.
  isBusy: boolean;
  unlinkingId: string | null;
  // The row the last link added, so it can rise in.
  linkedId: string | null;
  pick: (guardianId: string) => void;
  link: () => void;
  // Resolves true once unlinked (the row is gone).
  unlink: (guardian: ChildGuardianRead) => Promise<boolean>;
};

// Loads the active Guardians only while the sheet is open.
export function useChildGuardians(
  child: ChildDetail,
  isOpen: boolean,
): ChildGuardians {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { memberId } = useParams();
  const candidates = useQuery({
    ...familyQueries.activeGuardians(),
    enabled: isOpen,
  });
  const linkMutation = useMutation(familyMutations.linkGuardian());
  const unlinkMutation = useMutation({
    ...familyMutations.updateChild(),
    // unlink() refreshes itself, after moving the page if it must.
    onSuccess: undefined,
  });
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [linkedId, setLinkedId] = useState<string | null>(null);
  // The Guardian the unlink in flight is for.
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const linkedIds = new Set(child.guardians.map((guardian) => guardian.id));
  const options = (candidates.data ?? []).filter(
    (candidate) => !linkedIds.has(candidate.id),
  );

  const isBusy = linkMutation.isPending || unlinkingId !== null;

  function relink(guardian: ChildGuardianRead): void {
    linkMutation.mutate(
      { childId: child.id, guardianId: guardian.id },
      {
        onError: (error) => {
          // A second tap on Undo: they're linked already.
          if (errorStatus(error) === CONFLICT) return;

          showToast({
            tone: "error",
            message: `Couldn’t link ${guardian.name}. Try again.`,
          });
        },
      },
    );
  }

  function link(): void {
    const picked = options.find((candidate) => candidate.id === pickedId);
    if (!picked || isBusy) return;

    setFailure(null);
    linkMutation.mutate(
      { childId: child.id, guardianId: picked.id },
      {
        onSuccess: () => {
          setPickedId(null);
          setLinkedId(picked.id);
          showToast({
            tone: "success",
            message: `${picked.name} linked to ${child.name}.`,
          });
        },
        onError: () =>
          setFailure(
            `Couldn’t link ${picked.name}. Check your connection and try again.`,
          ),
      },
    );
  }

  // The page shows the family of the URL's member. Unlinking that
  // Guardian takes the Child out of it, so the page first moves to the
  // Child under a remaining Guardian (loaded first, so the overlay never
  // flashes "isn't in this family"). `from` is the history entry the
  // unlink started on: the move only replaces that one.
  // Resolves true once the page has moved.
  async function followChild(
    remaining: ChildGuardianRead[],
    from: Location,
  ): Promise<boolean> {
    const next = remaining.find((linked) => !linked.archived) ?? remaining[0];
    // Never throws: on a failure the page loads (and words) it itself.
    await queryClient.prefetchQuery(familyQueries.household(next.id));
    // The user left while this ran (closed the Child, went Back, changed
    // page): replacing now would pull them back and drop their entry.
    // The router's own location may be gone with this hook, so ask the
    // browser's history, where BrowserRouter keeps each entry's key (under
    // a MemoryRouter this never matches, so tests use a BrowserRouter).
    const isStillThere = window.history.state?.key === from.key;
    if (isStillThere) {
      navigate(
        { pathname: familyPath(next.id), search: from.search },
        { replace: true, state: from.state },
      );
    }
    return isStillThere;
  }

  async function unlink(guardian: ChildGuardianRead): Promise<boolean> {
    if (child.guardians.length <= 1 || isBusy) return false;

    // Captured now: by the time the PATCH lands the user may be elsewhere.
    const from = location;
    let isUnlinked = false;
    setFailure(null);
    setUnlinkingId(guardian.id);
    const remaining = child.guardians.filter(
      (linked) => linked.id !== guardian.id,
    );
    try {
      await unlinkMutation.mutateAsync({
        childId: child.id,
        changes: { guardian_ids: remaining.map((linked) => linked.id) },
      });
      const hasMoved =
        guardian.id === memberId && (await followChild(remaining, from));
      // The move renders as a transition: a refetch of the old family
      // could land first and flash "isn't in this family".
      await refreshFamilies(
        queryClient,
        hasMoved ? { movingFrom: memberId } : {},
      );
      showToast({
        tone: "success",
        message: `${guardian.name} unlinked from ${child.name}.`,
        actionLabel: "Undo",
        onAction: () => relink(guardian),
      });
      isUnlinked = true;
    } catch (error) {
      setFailure(
        errorStatus(error) === CONFLICT
          ? `${guardian.name} can’t be unlinked: ${child.name} has upcoming Bookings at their Home. Change them to another Location first.`
          : `Couldn’t unlink ${guardian.name}. Try again.`,
      );
    } finally {
      setUnlinkingId(null);
    }
    return isUnlinked;
  }

  return {
    candidates,
    options,
    pickedId,
    failure,
    isLinking: linkMutation.isPending,
    isBusy,
    unlinkingId,
    linkedId,
    pick: setPickedId,
    link,
    unlink,
  };
}
