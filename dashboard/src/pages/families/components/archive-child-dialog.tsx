// Archive a Child: cancels their upcoming Bookings, which Restore won't
// bring back.
import type { ReactNode } from "react";
import { ConfirmDialog } from "@/components/kit/overlays/dialog";
import { describeChildArchive } from "@/lib/families/child-labels";
import type { ChildArchive } from "@/pages/families/hooks/use-child-archive";
import type { ChildDetail } from "@/types/families";

type ArchiveChildDialogProps = { child: ChildDetail; archive: ChildArchive };

export default function ArchiveChildDialog({
  child,
  archive,
}: ArchiveChildDialogProps): ReactNode {
  return (
    <ConfirmDialog
      isOpen={archive.isConfirming}
      onClose={archive.cancelArchive}
      onConfirm={archive.archive}
      title={`Archive ${child.name}?`}
      confirmLabel="Archive child"
      keepLabel="Keep child"
      isDestructive
      isWorking={archive.isArchiving}
    >
      <p>{describeChildArchive(child.upcoming_session_count)}</p>
    </ConfirmDialog>
  );
}
