// Archive and Restore for the family's Homes. Archive confirms first;
// a Home that upcoming Bookings still use is refused (409 with
// `booking_ids`), which opens the explanation instead. No Undo (§17 #3).
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/components/kit/overlays/use-toast";
import { bookingIdsOf } from "@/lib/api";
import { familyMutations } from "@/lib/queries/families";
import type { HouseholdHome } from "@/types/families";

export type BlockedArchive = { home: HouseholdHome; bookingCount: number };

type HomeArchiveOptions = {
  onArchived: () => void;
  onRestored: (homeId: string) => void;
};

export type HomeArchive = {
  confirming: HouseholdHome | null;
  blocked: BlockedArchive | null;
  isArchiving: boolean;
  restoringId: string | null;
  askToArchive: (home: HouseholdHome) => void;
  cancelArchive: () => void;
  confirmArchive: () => void;
  dismissBlocked: () => void;
  restore: (home: HouseholdHome) => void;
};

export function useHomeArchive({
  onArchived,
  onRestored,
}: HomeArchiveOptions): HomeArchive {
  const archive = useMutation(familyMutations.archive());
  const restore = useMutation(familyMutations.restore());
  const { showToast } = useToast();
  // The kit dialogs hold their copy while they close.
  const [confirming, setConfirming] = useState<HouseholdHome | null>(null);
  const [blocked, setBlocked] = useState<BlockedArchive | null>(null);

  function confirmArchive(): void {
    if (!confirming || archive.isPending) return;
    const home = confirming;
    archive.mutate(
      { type: "home", id: home.id },
      {
        onSuccess: () => {
          setConfirming(null);
          showToast({ tone: "success", message: "Home archived." });
          onArchived();
        },
        onError: (error) => {
          setConfirming(null);
          const bookingIds = bookingIdsOf(error);
          if (bookingIds) {
            setBlocked({ home, bookingCount: bookingIds.length });
            return;
          }
          showToast({ tone: "error", message: "Couldn’t archive the Home. Try again." });
        },
      },
    );
  }

  return {
    confirming,
    blocked,
    isArchiving: archive.isPending,
    restoringId: restore.isPending ? (restore.variables?.id ?? null) : null,
    askToArchive: setConfirming,
    cancelArchive: () => {
      if (!archive.isPending) setConfirming(null);
    },
    confirmArchive,
    dismissBlocked: () => setBlocked(null),
    restore: (home) =>
      restore.mutate(
        { type: "home", id: home.id },
        {
          onSuccess: () => {
            showToast({ tone: "success", message: "Home restored." });
            onRestored(home.id);
          },
          onError: () =>
            showToast({ tone: "error", message: "Couldn’t restore the Home. Try again." }),
        },
      ),
  };
}
