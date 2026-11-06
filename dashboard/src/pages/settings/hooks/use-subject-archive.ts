// Archive (confirm first, no Undo) and Restore (at once) for the Subject
// in the Edit sheet. Both act on the Subject as stored: the sheet's
// unsaved edits are not saved, and the name in every message is the
// stored one. Neither touches the Settings Save bar.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/kit/overlays/use-toast";
import {
  archiveSubject,
  refreshSubjects,
  restoreSubject,
} from "@/lib/queries/subjects";
import type { Subject } from "@/lib/queries/subjects";

export type SubjectArchive = {
  isConfirming: boolean;
  isArchiving: boolean;
  archiveFailure: string | null;
  askToArchive: () => void;
  cancel: () => void;
  confirm: () => void;
  isRestoring: boolean;
  restoreFailure: string | null;
  restore: () => void;
  clearRestoreFailure: () => void;
};

// Null in the Add sheet, where neither act exists.
export function useSubjectArchive(
  subject: Subject | null,
  // Closes the sheet.
  onClose: () => void,
  // Runs once the list has refetched, to put focus somewhere that lasts.
  onActed: () => void,
  // Clears the sheet's save alert, so only the latest alert shows.
  onActStart: () => void,
): SubjectArchive {
  const client = useQueryClient();
  const { showToast } = useToast();
  const [isConfirming, setIsConfirming] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [archiveFailure, setArchiveFailure] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreFailure, setRestoreFailure] = useState<string | null>(null);

  async function finish(message: string): Promise<void> {
    onClose();
    showToast({ tone: "success", message });
    await refreshSubjects(client);
    onActed();
  }

  function askToArchive(): void {
    setArchiveFailure(null);
    setIsConfirming(true);
  }

  async function confirm(): Promise<void> {
    if (!subject || isArchiving) return;
    setArchiveFailure(null);
    setIsArchiving(true);
    try {
      await archiveSubject(subject.id);
      setIsConfirming(false);
      void finish(`${subject.name} archived.`);
    } catch {
      setArchiveFailure(
        `Couldn’t archive ${subject.name}. Check your connection and try again.`,
      );
    } finally {
      setIsArchiving(false);
    }
  }

  async function restore(): Promise<void> {
    if (!subject || isRestoring) return;
    onActStart();
    setRestoreFailure(null);
    setIsRestoring(true);
    try {
      await restoreSubject(subject.id);
      void finish(`${subject.name} restored.`);
    } catch {
      setRestoreFailure(`Couldn’t restore ${subject.name}.`);
    } finally {
      setIsRestoring(false);
    }
  }

  return {
    isConfirming,
    isArchiving,
    archiveFailure,
    askToArchive,
    // Closing mid-archive would hide whether it worked.
    cancel: () => {
      if (!isArchiving) setIsConfirming(false);
    },
    confirm: () => void confirm(),
    isRestoring,
    restoreFailure,
    restore: () => void restore(),
    clearRestoreFailure: () => setRestoreFailure(null),
  };
}
