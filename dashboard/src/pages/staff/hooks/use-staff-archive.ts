// Archive for Staff details. The confirm reads their upcoming Bookings
// fresh each time it opens and holds the confirm until the count is in;
// nothing is cancelled, they wait in To do. There's no Undo: Restore is
// its own act (DESIGN.md §11.6).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getTodayKey } from "@/components/kit/format";
import { useToast } from "@/components/kit/overlays/use-toast";
import { errorDetail, errorStatus } from "@/lib/api";
import { invalidateBookingData } from "@/lib/queries/bookings";
import {
  archiveStaff,
  refreshStaff,
  staffDirectoryQueries,
} from "@/lib/queries/staff";
import type { StaffRead } from "@/lib/queries/staff";
import {
  PEER_ADMIN_LOCK,
  SELF_LOCK,
} from "@/pages/staff/lib/staff-permissions";

const FORBIDDEN = 403;
const ARCHIVE_FAILED =
  "Couldn’t archive them. Check your connection and try again.";

export type StaffArchive = {
  isConfirming: boolean;
  // Undefined while it loads (or failed).
  upcomingCount: number | undefined;
  hasCountFailed: boolean;
  isRetryingCount: boolean;
  retryCount: () => void;
  isArchiving: boolean;
  failure: string | null;
  askToArchive: () => void;
  cancel: () => void;
  confirm: () => void;
};

function getArchivedMessage(name: string, upcomingCount: number): string {
  const waiting =
    upcomingCount === 1
      ? " 1 Booking waits in To do."
      : ` ${upcomingCount} Bookings wait in To do.`;
  return `${name} archived.${upcomingCount > 0 ? waiting : ""}`;
}

function describeFailure(error: unknown): string {
  let message = ARCHIVE_FAILED;
  if (errorStatus(error) === FORBIDDEN) {
    message = /your own/i.test(errorDetail(error) ?? "")
      ? SELF_LOCK
      : PEER_ADMIN_LOCK;
  }
  return message;
}

// Takes the row once loaded; until then nothing can call it.
export function useStaffArchive(staff: StaffRead | undefined): StaffArchive {
  const client = useQueryClient();
  const { showToast } = useToast();
  const [isConfirming, setIsConfirming] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const staffId = staff?.id ?? "";
  const name = staff?.name ?? "";
  const countQuery = staffDirectoryQueries.upcomingBookingCount(
    staffId,
    getTodayKey(),
  );
  const count = useQuery({
    ...countQuery,
    enabled: isConfirming && staffId !== "",
  });
  const mutation = useMutation({ mutationFn: archiveStaff });
  const upcomingCount = count.data;

  function askToArchive(): void {
    // A count from an earlier ask may be stale: read it again.
    client.removeQueries({ queryKey: countQuery.queryKey });
    setFailure(null);
    setIsConfirming(true);
  }

  function confirm(): void {
    if (upcomingCount === undefined || mutation.isPending) return;
    setFailure(null);
    mutation.mutate(staffId, {
      onSuccess: () => {
        setIsConfirming(false);
        showToast({
          tone: "success",
          message: getArchivedMessage(name, upcomingCount),
        });
        void refreshStaff(client);
        // Their Bookings now wait in To do; their Children lost them.
        void invalidateBookingData(client);
      },
      onError: (error) => setFailure(describeFailure(error)),
    });
  }

  return {
    isConfirming,
    upcomingCount,
    hasCountFailed:
      upcomingCount === undefined &&
      (count.isError || count.errorUpdateCount > 0),
    isRetryingCount: count.isFetching,
    retryCount: () => void count.refetch(),
    isArchiving: mutation.isPending,
    failure,
    askToArchive,
    // Closing mid-archive would hide whether it worked.
    cancel: () => {
      if (!mutation.isPending) setIsConfirming(false);
    },
    confirm,
  };
}
