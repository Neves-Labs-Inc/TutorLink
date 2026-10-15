// Staff details in the kit's DetailOverlay: sign-in state with Invite,
// subjects, this week, and Archive behind a destructive confirm.
import { useState } from "react";
import type { ReactNode } from "react";
import { BookOpen, CalendarDays, Mail, ShieldCheck } from "lucide-react";
import type { Staff } from "@/pages/prototype/shell-kit/kit/mock-data";
import {
  ArchivedBadge,
  Avatar,
  SignInBadge,
} from "@/pages/prototype/shell-kit/kit/components/badges";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import { DetailRow } from "@/pages/prototype/shell-kit/kit/components/detail";
import { DetailOverlay } from "@/pages/prototype/shell-kit/kit/overlays/detail-overlay";
import type { PhoneDetailMode } from "@/pages/prototype/shell-kit/kit/overlays/detail-overlay";
import { ConfirmDialog } from "@/pages/prototype/shell-kit/kit/overlays/dialog";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";

type StaffDetailProps = {
  staff: Staff | null;
  onClose: () => void;
  phoneMode: PhoneDetailMode;
  // Staff sign-in and Archive are Admin-only; Managers just view.
  canManage?: boolean;
};

export default function StaffDetail({
  staff,
  onClose,
  phoneMode,
  canManage = true,
}: StaffDetailProps): ReactNode {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const { showToast } = useToast();
  if (!staff) return null;

  function handleArchive(name: string): void {
    setIsConfirmOpen(false);
    onClose();
    showToast({
      tone: "success",
      message: `${name} archived.`,
      actionLabel: "Undo",
      onAction: () => showToast({ tone: "info", message: `${name} restored.` }),
    });
  }

  const canInvite = !staff.isArchived && staff.signIn !== "Active";
  return (
    <>
      <DetailOverlay
        isOpen
        onClose={onClose}
        title={`Staff: ${staff.name}`}
        backLabel="Staff"
        phoneMode={phoneMode}
        header={
          staff.isArchived ? (
            <ArchivedBadge />
          ) : (
            <SignInBadge state={staff.signIn} />
          )
        }
        footer={
          canManage ? (
          <>
            {canInvite && (
              <Button
                variant="primary"
                icon={Mail}
                isFullWidth
                className="@md:flex-1"
                onClick={() =>
                  showToast({
                    tone: "success",
                    message: `Invite sent to ${staff.email || "their email"}.`,
                  })
                }
              >
                {staff.signIn === "Invited" ? "Send Invite again" : "Send Invite"}
              </Button>
            )}
            {staff.isArchived ? (
              <Button isFullWidth className="@md:flex-1">
                Restore
              </Button>
            ) : (
              <Button
                variant="danger-outline"
                isFullWidth
                className="@md:flex-1"
                onClick={() => setIsConfirmOpen(true)}
              >
                Archive
              </Button>
            )}
          </>
          ) : undefined
        }
      >
        <div className="flex items-center gap-4">
          <Avatar name={staff.name} size="lg" />
          <div className="min-w-0">
            <h2 className="kit-display truncate text-[28px] leading-9 font-light">
              {staff.name}
            </h2>
            <p className="text-[14px] text-(--tl-muted)">{staff.role}</p>
          </div>
        </div>
        <div className="mt-6 flex flex-col gap-5">
          <DetailRow icon={Mail} label="Email">
            {staff.email ? (
              <p className="font-semibold break-all">{staff.email}</p>
            ) : (
              <p className="text-(--tl-muted)">No email yet. Add one to send an Invite.</p>
            )}
          </DetailRow>
          <DetailRow icon={ShieldCheck} label="Sign-in">
            <p className="font-semibold">{staff.signIn}</p>
          </DetailRow>
          <DetailRow icon={BookOpen} label="Subjects">
            <p className="font-semibold">{staff.subjects.join(", ")}</p>
          </DetailRow>
          <DetailRow icon={CalendarDays} label="This week">
            <p className="font-semibold tabular-nums">
              {staff.sessionsThisWeek} bookings
            </p>
          </DetailRow>
        </div>
      </DetailOverlay>
      <ConfirmDialog
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        onConfirm={() => handleArchive(staff.name)}
        title={`Archive ${staff.name}?`}
        confirmLabel="Archive"
        keepLabel="Keep active"
        isDestructive
      >
        {staff.name} won’t be able to sign in any more. Their past
        Bookings stay. You can Restore them later.
      </ConfirmDialog>
    </>
  );
}
