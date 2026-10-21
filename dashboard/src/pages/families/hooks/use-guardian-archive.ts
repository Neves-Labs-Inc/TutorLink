// Archive and Restore for Guardian details. Archive confirms first,
// with what the cascade takes (worked out from the open family), and
// sends that count back; when the API counts differently (409) the
// family is reloaded and the confirm reopens with the new numbers.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/kit/overlays/use-toast";
import type { Family } from "@/hooks/use-family";
import { errorStatus } from "@/lib/api";
import {
  describeArchived,
  guardianArchiveCascade,
} from "@/lib/families/guardian-archive";
import type {
  CascadeFamily,
  GuardianArchiveCascade,
} from "@/lib/families/guardian-archive";
import { familyMutations, refreshFamilies } from "@/lib/queries/families";
import type { ArchiveRead, ClientRead } from "@/types/families";

const CONFLICT = 409;

export type GuardianArchive = {
  cascade: GuardianArchiveCascade;
  isConfirming: boolean;
  isArchiving: boolean;
  isRestoring: boolean;
  askToArchive: () => void;
  cancelArchive: () => void;
  archive: () => void;
  restore: () => void;
};

// A Child whose details haven't loaded counts 0; the API's 409 then
// reloads them and the confirm reopens with the real count.
function toCascadeFamily(family: Family): CascadeFamily {
  return {
    guardians: family.guardians,
    children: family.children.map((child) => ({
      id: child.id,
      name: child.name,
      archived: child.archived,
      upcomingSessionCount: child.detail.data?.upcoming_session_count ?? 0,
    })),
  };
}

// Takes the Guardian once loaded; until then nothing can call it.
export function useGuardianArchive(
  family: Family,
  guardianId: string,
  guardian: ClientRead | undefined,
): GuardianArchive {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [isConfirming, setIsConfirming] = useState(false);
  const archiveMutation = useMutation(familyMutations.archive());
  const restoreMutation = useMutation(familyMutations.restore());
  const cascade = guardianArchiveCascade(toCascadeFamily(family), guardianId);
  const name = guardian?.name ?? "";

  function handleArchived(result: ArchiveRead): void {
    setIsConfirming(false);
    const childNames = family.children
      .filter((child) => result.archived_child_ids.includes(child.id))
      .map((child) => child.name);
    showToast({
      tone: "success",
      message: describeArchived(
        name,
        childNames,
        result.cancelled_booking_ids.length,
      ),
    });
  }

  async function handleArchiveFailed(error: unknown): Promise<void> {
    setIsConfirming(false);
    if (errorStatus(error) === CONFLICT) {
      await refreshFamilies(queryClient);
      setIsConfirming(true);
    } else {
      showToast({ tone: "error", message: `Couldn’t archive ${name}. Try again.` });
    }
  }

  function handleRestored(): void {
    // Their Children were archived with them, or since; either way they
    // stay archived.
    const hasArchivedChildren =
      guardian?.children.some((child) => child.archived) ?? false;
    showToast({
      tone: "success",
      message: hasArchivedChildren
        ? `${name} restored. Their Children stay archived until you restore them.`
        : `${name} restored.`,
    });
  }

  return {
    cascade,
    isConfirming,
    isArchiving: archiveMutation.isPending,
    isRestoring: restoreMutation.isPending,
    askToArchive: () => setIsConfirming(true),
    cancelArchive: () => setIsConfirming(false),
    archive: () =>
      archiveMutation.mutate(
        {
          type: "guardian",
          id: guardianId,
          expected_cancellations: cascade.cancellations,
        },
        {
          onSuccess: handleArchived,
          onError: (error) => void handleArchiveFailed(error),
        },
      ),
    restore: () =>
      restoreMutation.mutate(
        { type: "guardian", id: guardianId },
        {
          onSuccess: handleRestored,
          onError: () =>
            showToast({
              tone: "error",
              message: `Couldn’t restore ${name}. Try again.`,
            }),
        },
      ),
  };
}
