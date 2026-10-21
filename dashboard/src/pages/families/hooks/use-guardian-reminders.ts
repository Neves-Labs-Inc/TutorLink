// The Booking reminders sheet's data: the Guardian's choice history
// (loaded while the sheet is open) and recording the other choice.
// A recorded choice updates in place: the sheet, the header badge and
// the Booking reminders row all read the new state at once.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { errorStatus } from "@/lib/api";
import {
  canRecordConsent,
  nextConsentAction,
} from "@/lib/families/guardian-labels";
import {
  familyKeys,
  familyMutations,
  familyQueries,
} from "@/lib/queries/families";
import type {
  ClientRead,
  ConsentAction,
  GuardianRemindersRead,
  RemindersConsent,
} from "@/types/families";

const CONFLICT = 409;
const RECORD_FAILED =
  "Couldn’t record that. Check your connection and try again.";

export type GuardianReminders = {
  history: UseQueryResult<GuardianRemindersRead>;
  state: RemindersConsent;
  isBlocked: boolean;
  // Null when recording is refused (WhatsApp's block).
  nextAction: ConsentAction | null;
  isRecording: boolean;
  recordError: string | null;
  // The history row just recorded, so it can enter with kit-rise.
  newRowId: string | null;
  record: () => void;
};

export function useGuardianReminders(
  guardian: ClientRead,
  isOpen: boolean,
): GuardianReminders {
  const queryClient = useQueryClient();
  const history = useQuery({
    ...familyQueries.reminders(guardian.id),
    enabled: isOpen,
  });
  const recordConsent = useMutation(familyMutations.recordConsent());
  // A 409 says WhatsApp blocks the number before the refetch shows it.
  const [isRefused, setIsRefused] = useState(false);
  const [newRowId, setNewRowId] = useState<string | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);

  const consent = history.data?.consent;
  const state = consent?.state ?? guardian.reminders;
  const isBlocked =
    isRefused ||
    (consent?.blocked_by_whatsapp ?? guardian.reminders_blocked_by_whatsapp);
  const nextAction = canRecordConsent(state, isBlocked)
    ? nextConsentAction(state)
    : null;

  function handleRecorded(updated: GuardianRemindersRead): void {
    queryClient.setQueryData(familyKeys.reminders(guardian.id), updated);
    queryClient.setQueryData<ClientRead>(
      familyKeys.guardian(guardian.id),
      (current) =>
        current && {
          ...current,
          reminders: updated.consent.state,
          reminders_blocked_by_whatsapp: updated.consent.blocked_by_whatsapp,
        },
    );
    setNewRowId(updated.history[0]?.id ?? null);
  }

  function handleRefused(error: unknown): void {
    const isConflict = errorStatus(error) === CONFLICT;
    setIsRefused(isConflict);
    setRecordError(isConflict ? null : RECORD_FAILED);
    if (isConflict) {
      void queryClient.invalidateQueries({
        queryKey: familyKeys.guardian(guardian.id),
      });
      void history.refetch();
    }
  }

  return {
    history,
    state,
    isBlocked,
    nextAction,
    isRecording: recordConsent.isPending,
    recordError,
    newRowId,
    record: () => {
      if (nextAction === null) return;

      setRecordError(null);
      recordConsent.mutate(
        { guardianId: guardian.id, action: nextAction },
        { onSuccess: handleRecorded, onError: handleRefused },
      );
    },
  };
}
