// A Child's details (GET /api/children/{id}): profile, Child notes,
// Evaluation and Subject levels, next booking, Guardians (each opens
// Guardian details), and where they can be booked, read-only. Every act
// on the Child lives here: Edit and Archive under ⋯, levels and the
// Evaluated mark inline, booking in the footer.
import { useState } from "react";
import type { ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  Cake,
  GraduationCap,
  MoreHorizontal,
  Pencil,
  School,
} from "lucide-react";
import { cn, EYEBROW } from "@/pages/prototype/shell-kit/kit/tokens";
import {
  ArchivedBadge,
  Avatar,
} from "@/pages/prototype/shell-kit/kit/components/badges";
import { Button, IconButton } from "@/pages/prototype/shell-kit/kit/components/button";
import { DetailRow, NotesCard } from "@/pages/prototype/shell-kit/kit/components/detail";
import { DetailOverlay } from "@/pages/prototype/shell-kit/kit/overlays/detail-overlay";
import { ConfirmDialog } from "@/pages/prototype/shell-kit/kit/overlays/dialog";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";
import ActionsSheet from "@/pages/prototype/accounts-staff/components/actions-sheet";
import ChildEvaluation from "@/pages/prototype/accounts-staff/components/child-evaluation";
import ChildPeople from "@/pages/prototype/accounts-staff/components/child-people";
import { EditChildSheet } from "@/pages/prototype/accounts-staff/components/child-sheets";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import {
  formatAge,
  formatGrade,
  formatWeekdayDate,
  formatWireTime,
} from "@/pages/prototype/accounts-staff/lib/labels";
import { TODAY } from "@/pages/prototype/accounts-staff/lib/mock-data";
import type { ChildDetail } from "@/pages/prototype/accounts-staff/types/api";

type ChildDetailsProps = {
  child: ChildDetail;
  backLabel: string;
  onBack: () => void;
  onClose: () => void;
  onOpenGuardian: (id: string) => void;
};

export default function ChildDetails({
  child,
  backLabel,
  onBack,
  onClose,
  onOpenGuardian,
}: ChildDetailsProps): ReactNode {
  const { updateChild, setChildArchived } = useArea();
  const { showToast } = useToast();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isConfirmingArchive, setIsConfirmingArchive] = useState(false);
  const next = child.next_session;
  const upcoming = child.upcoming_session_count;

  function handleArchive(): void {
    setIsConfirmingArchive(false);
    const cancelled = setChildArchived(child.id, true);
    showToast({
      tone: "success",
      message:
        cancelled > 0
          ? `${child.name} archived. ${cancelled} upcoming ${cancelled === 1 ? "Booking was" : "Bookings were"} cancelled.`
          : `${child.name} archived.`,
    });
  }

  function handleRestore(): void {
    setChildArchived(child.id, false);
    showToast({ tone: "success", message: `${child.name} restored. Cancelled Bookings stay cancelled.` });
  }

  const bookLabel = child.evaluated ? "New booking" : "Book evaluation";
  return (
    <>
      <DetailOverlay
        isOpen
        onClose={onClose}
        onBack={onBack}
        title={`Child: ${child.name}`}
        backLabel={backLabel}
        phoneMode="page"
        header={
          <div className="flex min-h-11 items-center justify-between gap-2">
            {child.archived ? <ArchivedBadge /> : <span />}
            <IconButton icon={MoreHorizontal} label="More actions" onClick={() => setIsMenuOpen(true)} />
          </div>
        }
        footer={
          child.archived ? undefined : (
            <Button
              variant="primary"
              isFullWidth
              icon={CalendarDays}
              onClick={() =>
                showToast({ tone: "info", message: `${bookLabel} opens the Bookings form with ${child.name} picked.` })
              }
            >
              {bookLabel}
            </Button>
          )
        }
      >
        <div className="flex items-center gap-4">
          <Avatar name={child.name} size="lg" />
          <h2 className="kit-display min-w-0 truncate text-[28px] leading-9 font-light">{child.name}</h2>
        </div>
        <div className="mt-6 flex flex-col gap-5">
          <DetailRow icon={Cake} label="Date of birth">
            <p className="font-semibold">{formatAge(child.date_of_birth, TODAY)}</p>
          </DetailRow>
          <DetailRow icon={GraduationCap} label="Overall grade">
            <p className="font-semibold">{formatGrade(child.grade_level)}</p>
          </DetailRow>
          <DetailRow icon={School} label="School">
            <p className="font-semibold">{child.school_name || "Not recorded"}</p>
          </DetailRow>
          <DetailRow icon={CalendarDays} label="Next booking">
            {next ? (
              <p className="font-semibold">
                {formatWeekdayDate(next.scheduled_date)}, {formatWireTime(next.start_time)} · {next.tutor.name}
                <span className="block text-[13px] font-normal text-(--tl-muted)">
                  {upcoming} upcoming {upcoming === 1 ? "Booking" : "Bookings"}
                </span>
              </p>
            ) : (
              <p className="text-(--tl-muted)">Nothing booked</p>
            )}
          </DetailRow>
        </div>
        <div className="mt-6">
          {child.notes ? (
            <NotesCard>{child.notes}</NotesCard>
          ) : (
            <p className="rounded-[16px] bg-(--tl-surface-sunk) px-4 py-3 text-[14px] text-(--tl-muted)">
              No Child notes yet. Add them with Edit details.
            </p>
          )}
        </div>
        <ChildEvaluation child={child} />
        <h3 className={cn(EYEBROW, "mt-8 mb-3")}>
          {child.guardians.length === 1 ? "Guardian" : `Guardians · ${child.guardians.length}`}
        </h3>
        <ChildPeople child={child} onOpenGuardian={onOpenGuardian} />
      </DetailOverlay>
      <ActionsSheet
        isOpen={isMenuOpen}
        title={child.name}
        onClose={() => setIsMenuOpen(false)}
        actions={[
          { id: "edit", label: "Edit details", icon: Pencil, description: "Name, birthday, grade, school, Child notes", onSelect: () => setIsEditing(true) },
          child.archived
            ? { id: "restore", label: "Restore", icon: ArchiveRestore, onSelect: handleRestore }
            : { id: "archive", label: "Archive", icon: Archive, isDanger: true, description: upcoming > 0 ? `Cancels ${upcoming} upcoming ${upcoming === 1 ? "Booking" : "Bookings"}` : undefined, onSelect: () => setIsConfirmingArchive(true) },
        ]}
      />
      {isEditing && (
        <EditChildSheet
          child={child}
          onClose={() => setIsEditing(false)}
          onSave={(edit) => {
            updateChild(child.id, edit);
            setIsEditing(false);
            showToast({ tone: "success", message: "Details saved." });
          }}
        />
      )}
      <ConfirmDialog
        isOpen={isConfirmingArchive}
        onClose={() => setIsConfirmingArchive(false)}
        onConfirm={handleArchive}
        title={`Archive ${child.name}?`}
        confirmLabel={upcoming > 0 ? `Archive and cancel ${upcoming}` : "Archive"}
        keepLabel="Keep"
        isDestructive
      >
        {upcoming > 0
          ? `Their ${upcoming} upcoming ${upcoming === 1 ? "Booking is" : "Bookings are"} cancelled, and Restore won’t bring ${upcoming === 1 ? "it" : "them"} back.`
          : "They leave the Children list and can’t be booked. Restore brings them back."}
      </ConfirmDialog>
    </>
  );
}
