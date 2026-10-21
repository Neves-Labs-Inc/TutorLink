// Archive and Restore for Child details. Archive confirms first with the
// Child's upcoming Bookings and sends that count back; when the API
// counts differently (409) the Child is reloaded and the confirm reopens
// with the new number.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/kit/overlays/use-toast";
import { errorStatus } from "@/lib/api";
import { describeChildArchived } from "@/lib/families/child-labels";
import { familyMutations, refreshFamilies } from "@/lib/queries/families";
import type { ArchiveRead, ChildDetail } from "@/types/families";

const CONFLICT = 409;

export type ChildArchive = {
  isConfirming: boolean;
  isArchiving: boolean;
  isRestoring: boolean;
  askToArchive: () => void;
  cancelArchive: () => void;
  archive: () => void;
  restore: () => void;
};

// Takes the Child once loaded; until then nothing can call it.
export function useChildArchive(
  childId: string,
  child: ChildDetail | undefined,
): ChildArchive {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [isConfirming, setIsConfirming] = useState(false);
  const archiveMutation = useMutation(familyMutations.archive());
  const restoreMutation = useMutation(familyMutations.restore());
  const name = child?.name ?? "";

  function handleArchived(result: ArchiveRead): void {
    setIsConfirming(false);
    showToast({
      tone: "success",
      message: describeChildArchived(name, result.cancelled_booking_ids.length),
    });
  }

  async function handleArchiveFailed(error: unknown): Promise<void> {
    setIsConfirming(false);
    if (errorStatus(error) === CONFLICT) {
      await refreshFamilies(queryClient, { hasBookings: true });
      setIsConfirming(true);
    } else {
      showToast({ tone: "error", message: `Couldn’t archive ${name}. Try again.` });
    }
  }

  return {
    isConfirming,
    isArchiving: archiveMutation.isPending,
    isRestoring: restoreMutation.isPending,
    askToArchive: () => setIsConfirming(true),
    cancelArchive: () => setIsConfirming(false),
    archive: () =>
      archiveMutation.mutate(
        {
          type: "child",
          id: childId,
          expected_cancellations: child?.upcoming_session_count ?? 0,
        },
        {
          onSuccess: handleArchived,
          onError: (error) => void handleArchiveFailed(error),
        },
      ),
    restore: () =>
      restoreMutation.mutate(
        { type: "child", id: childId },
        {
          onSuccess: () =>
            showToast({
              tone: "success",
              message: `${name} restored. Cancelled Bookings stay cancelled.`,
            }),
          onError: () =>
            showToast({
              tone: "error",
              message: `Couldn’t restore ${name}. Try again.`,
            }),
        },
      ),
  };
}
