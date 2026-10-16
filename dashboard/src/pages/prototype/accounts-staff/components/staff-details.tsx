// Staff details: a header (name, role, sign-in state, Edit, ⋯) and tabs
// Overview · Availability · Time off · Bookings. Admins have no teaching
// profile, so no Availability tab. Managers see everything, change
// nothing. The kit's slide-over (desktop) / pushed page (phone).
import { useState } from "react";
import type { ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  Eye,
  KeyRound,
  Lock,
  Mail,
  MoreHorizontal,
  Pencil,
} from "lucide-react";
import {
  ArchivedBadge,
  Avatar,
  SignInBadge,
} from "@/pages/prototype/shell-kit/kit/components/badges";
import { Button, IconButton } from "@/pages/prototype/shell-kit/kit/components/button";
import { SubPageTabs } from "@/pages/prototype/shell-kit/kit/components/tabs";
import { DetailOverlay } from "@/pages/prototype/shell-kit/kit/overlays/detail-overlay";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";
import ActionsSheet from "@/pages/prototype/accounts-staff/components/actions-sheet";
import type { SheetAction } from "@/pages/prototype/accounts-staff/components/actions-sheet";
import ArchiveStaffDialog from "@/pages/prototype/accounts-staff/components/archive-staff-dialog";
import EditStaffSheet from "@/pages/prototype/accounts-staff/components/edit-staff-sheet";
import StaffAvailabilityTab from "@/pages/prototype/accounts-staff/components/staff-availability-tab";
import StaffBookingsTab from "@/pages/prototype/accounts-staff/components/staff-bookings-tab";
import StaffOverviewTab from "@/pages/prototype/accounts-staff/components/staff-overview-tab";
import StaffTimeOffTab from "@/pages/prototype/accounts-staff/components/staff-time-off-tab";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import {
  getRoleLabel,
  getSignInLabel,
} from "@/pages/prototype/accounts-staff/lib/labels";
import { readStaff } from "@/pages/prototype/accounts-staff/lib/mock-api";
import { getStaffPermissions } from "@/pages/prototype/accounts-staff/lib/staff-rules";
import type { OfficeRole } from "@/pages/prototype/accounts-staff/types/screens";

type Tab = "overview" | "availability" | "time-off" | "bookings";

type StaffDetailsProps = {
  staffId: string;
  role: OfficeRole;
  backLabel: string;
  onClose: () => void;
};

export default function StaffDetails({
  staffId,
  role,
  backLabel,
  onClose,
}: StaffDetailsProps): ReactNode {
  const { db, actor, sendInvite, setStaffArchived } = useArea();
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>("overview");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const staff = readStaff(db, staffId);
  if (!staff) return null;

  const can = getStaffPermissions(role, actor.id, staff);
  const isTeacher = staff.tutor_id !== null;
  const tabs = [
    { id: "overview", label: "Overview" },
    ...(isTeacher ? [{ id: "availability", label: "Availability" }] : []),
    { id: "time-off", label: "Time off" },
    { id: "bookings", label: "Bookings" },
  ];

  function handleInvite(): void {
    if (!staff) return;
    sendInvite(staff.id);
    showToast({ tone: "success", message: `Invite sent to ${staff.email}. It lasts 7 days.` });
  }

  const actions: SheetAction[] = [
    ...(can.canInvite
      ? [{ id: "invite", label: staff.sign_in_state === "invited" ? "Send invite again" : "Send invite", icon: Mail, description: `To ${staff.email}`, onSelect: handleInvite }]
      : []),
    ...(staff.sign_in_state === "active" && role === "admin" && !staff.archived
      ? [{ id: "reset", label: "Send password reset", icon: KeyRound, disabledReason: can.canResetPassword ? undefined : (can.lockReason ?? undefined), onSelect: () => showToast({ tone: "success", message: `Password reset sent to ${staff.email}.` }) }]
      : []),
    staff.archived
      ? { id: "restore", label: "Restore", icon: ArchiveRestore, description: "They sign in as before", disabledReason: can.canArchive ? undefined : (can.lockReason ?? undefined), onSelect: () => { setStaffArchived(staff.id, false); showToast({ tone: "success", message: `${staff.name} restored.` }); } }
      : { id: "archive", label: "Archive", icon: Archive, isDanger: true, description: "They can’t sign in or be booked", disabledReason: can.canArchive ? undefined : (can.lockReason ?? undefined), onSelect: () => setIsArchiving(true) },
  ];

  let tabBody: ReactNode;
  if (tab === "availability") tabBody = <StaffAvailabilityTab staff={staff} canEdit={can.canEditTeaching} />;
  else if (tab === "time-off") tabBody = <StaffTimeOffTab staff={staff} can={can} />;
  else if (tab === "bookings") tabBody = <StaffBookingsTab staff={staff} />;
  else tabBody = <StaffOverviewTab staff={staff} can={can} onGoTo={(next) => setTab(next)} onInvite={handleInvite} />;

  return (
    <>
      <DetailOverlay
        isOpen
        onClose={onClose}
        title={`Staff: ${staff.name}`}
        backLabel={backLabel}
        phoneMode="page"
        isHeaderPinned
        header={
          <div className="flex items-center justify-between gap-2">
            {staff.archived ? <ArchivedBadge /> : <SignInBadge state={getSignInLabel(staff.sign_in_state)} />}
            {role === "admin" && (
              <span className="flex items-center gap-1">
                <Button icon={Pencil} onClick={() => setIsEditing(true)} disabled={!can.canEdit}>
                  Edit
                </Button>
                <IconButton icon={MoreHorizontal} label="More actions" onClick={() => setIsMenuOpen(true)} />
              </span>
            )}
          </div>
        }
      >
        <div className="flex items-center gap-4">
          <Avatar name={staff.name} size="lg" />
          <div className="min-w-0">
            <h2 className="kit-display truncate text-[28px] leading-9 font-light">{staff.name}</h2>
            <p className="text-[14px] text-(--tl-muted)">{getRoleLabel(staff.role)}</p>
          </div>
        </div>
        {(role === "manager" || can.lockReason) && (
          <p className="mt-4 flex items-start gap-2 rounded-[16px] bg-(--tl-surface-sunk) px-4 py-3 text-[13px] leading-5 text-(--tl-ink-soft)">
            {role === "manager" ? <Eye aria-hidden className="mt-0.5 size-4 shrink-0" /> : <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />}
            {role === "manager" ? "View only. An Admin changes Staff, their teaching and their Time off." : can.lockReason}
          </p>
        )}
        <div className="mt-5 -mx-5 px-5 @2xl:-mx-6 @2xl:px-6">
          <SubPageTabs
            label="Staff details sections"
            activeId={tab}
            // Ids come from `tabs`.
            onChange={(id) => setTab(id as Tab)}
            items={tabs}
          />
        </div>
        <div className="pt-5">{tabBody}</div>
      </DetailOverlay>
      <ActionsSheet isOpen={isMenuOpen} title={staff.name} actions={actions} onClose={() => setIsMenuOpen(false)} />
      {isEditing && <EditStaffSheet staff={staff} canChangeRole={can.canChangeRole} onClose={() => setIsEditing(false)} />}
      <ArchiveStaffDialog staff={staff} isOpen={isArchiving} onClose={() => setIsArchiving(false)} />
    </>
  );
}
