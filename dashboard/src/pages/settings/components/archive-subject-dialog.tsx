// Archive's confirm for a Subject: who teaches it, what the bot stops
// doing, and that upcoming Bookings stay. No Undo; Restore is its own act.
import type { ReactNode } from "react";
import { ConfirmDialog } from "@/components/kit/overlays/dialog";
import type { Subject } from "@/lib/queries/subjects";
import { tutorCountSentence } from "@/lib/subjects/subjects";
import type { SubjectArchive } from "@/pages/settings/hooks/use-subject-archive";

const ALERT_LINE = "text-[14px] leading-5 font-medium text-(--tl-danger)";

type ArchiveSubjectDialogProps = {
  subject: Subject;
  archive: SubjectArchive;
};

export default function ArchiveSubjectDialog({
  subject,
  archive,
}: ArchiveSubjectDialogProps): ReactNode {
  return (
    <ConfirmDialog
      isOpen={archive.isConfirming}
      onClose={archive.cancel}
      onConfirm={archive.confirm}
      title={`Archive ${subject.name}?`}
      confirmLabel="Archive subject"
      keepLabel="Keep subject"
      isDestructive
      isWorking={archive.isArchiving}
    >
      <div className="flex flex-col gap-2">
        <p>
          {tutorCountSentence(subject.tutor_count)} The bot stops offering it
          and it can’t be picked for new Bookings or levels. Upcoming Bookings
          stay.
        </p>
        {archive.archiveFailure && (
          <p role="alert" className={`kit-fade ${ALERT_LINE}`}>
            {archive.archiveFailure}
          </p>
        )}
      </div>
    </ConfirmDialog>
  );
}
