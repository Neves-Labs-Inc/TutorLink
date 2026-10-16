// Guardian details (GET /api/clients/{id}): contact, Guardian language,
// Booking reminders, their Children (each opens the Child), Open chat,
// and their Homes, managed here. Edit and Archive live under ⋯.
import { useState } from "react";
import type { ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  BellRing,
  ChevronRight,
  Languages,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Phone,
} from "lucide-react";
import { CARD, cn, EYEBROW } from "@/pages/prototype/shell-kit/kit/tokens";
import {
  ArchivedBadge,
  Avatar,
  RemindersBadge,
} from "@/pages/prototype/shell-kit/kit/components/badges";
import { Button, IconButton } from "@/pages/prototype/shell-kit/kit/components/button";
import { DetailRow } from "@/pages/prototype/shell-kit/kit/components/detail";
import { DetailOverlay } from "@/pages/prototype/shell-kit/kit/overlays/detail-overlay";
import { ConfirmDialog } from "@/pages/prototype/shell-kit/kit/overlays/dialog";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";
import ActionsSheet from "@/pages/prototype/accounts-staff/components/actions-sheet";
import GuardianHomes from "@/pages/prototype/accounts-staff/components/guardian-homes";
import { EditGuardianSheet } from "@/pages/prototype/accounts-staff/components/guardian-sheets";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import {
  formatGrade,
  formatPhone,
  getLanguageLabel,
  getRemindersLabel,
} from "@/pages/prototype/accounts-staff/lib/labels";
import { listClients } from "@/pages/prototype/accounts-staff/lib/mock-api";
import type { ClientRead } from "@/pages/prototype/accounts-staff/types/api";

type GuardianDetailsProps = {
  guardian: ClientRead;
  backLabel: string;
  onBack: () => void;
  onClose: () => void;
  onOpenChild: (id: string) => void;
};

export default function GuardianDetails({
  guardian,
  backLabel,
  onBack,
  onClose,
  onOpenChild,
}: GuardianDetailsProps): ReactNode {
  const { db, updateGuardian, setGuardianArchived } = useArea();
  const { showToast } = useToast();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isConfirmingArchive, setIsConfirmingArchive] = useState(false);
  // ClientRead has no reminders fields (API gap), so they come from the
  // list row here.
  const summary = [...listClients(db, false), ...listClients(db, true)].find(
    (row) => row.id === guardian.id,
  );
  const remindersLabel = getRemindersLabel(summary?.reminders ?? "never");

  function handleArchive(): void {
    setIsConfirmingArchive(false);
    setGuardianArchived(guardian.id, true);
    showToast({ tone: "success", message: `${guardian.name} archived. They can no longer use the bot.` });
  }

  return (
    <>
      <DetailOverlay
        isOpen
        onClose={onClose}
        onBack={onBack}
        title={`Guardian: ${guardian.name}`}
        backLabel={backLabel}
        phoneMode="page"
        header={
          <div className="flex items-center justify-between gap-2">
            {guardian.archived ? <ArchivedBadge /> : <RemindersBadge state={remindersLabel} />}
            <IconButton icon={MoreHorizontal} label="More actions" onClick={() => setIsMenuOpen(true)} />
          </div>
        }
        footer={
          <Button
            variant="primary"
            icon={MessageCircle}
            isFullWidth
            onClick={() => showToast({ tone: "info", message: `Opens the chat with ${guardian.name} in Chats.` })}
          >
            Open chat
          </Button>
        }
      >
        <div className="flex items-center gap-4">
          <Avatar name={guardian.name} size="lg" />
          <h2 className="kit-display min-w-0 truncate text-[28px] leading-9 font-light">{guardian.name}</h2>
        </div>
        <div className="mt-6 flex flex-col gap-5">
          <DetailRow icon={Phone} label="WhatsApp">
            <p className="font-semibold tabular-nums">{formatPhone(guardian.phone_number)}</p>
          </DetailRow>
          <DetailRow icon={Languages} label="Guardian language">
            <p className="font-semibold">
              {getLanguageLabel(guardian.language)}
              {guardian.language === null && (
                <span className="block text-[13px] font-normal text-(--tl-muted)">Not detected yet, so English</span>
              )}
            </p>
          </DetailRow>
          <DetailRow icon={BellRing} label="Booking reminders">
            <p className="font-semibold">
              {remindersLabel}
              {summary?.reminders_blocked_by_whatsapp && (
                <span className="block text-[13px] font-normal text-(--tl-warning)">
                  WhatsApp is blocking reminders to this number
                </span>
              )}
            </p>
          </DetailRow>
        </div>

        <div className="mt-8 mb-3 flex items-center justify-between gap-1">
          <h3 className={EYEBROW}>
            {guardian.children.length === 1 ? "Child" : `Children · ${guardian.children.length}`}
          </h3>
        </div>
        <ul className="flex flex-col gap-2">
          {guardian.children.map((child) => (
            <li key={child.id}>
              <button
                type="button"
                onClick={() => onOpenChild(child.id)}
                aria-label={`Open ${child.name}`}
                className={cn(
                  CARD,
                  "flex min-h-[64px] w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:border-(--tl-hero)",
                  child.archived && "text-(--tl-muted)",
                )}
              >
                <Avatar name={child.name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{child.name}</span>
                  <span className="block text-[13px] text-(--tl-muted)">{formatGrade(child.grade_level)}</span>
                </span>
                {child.archived && <ArchivedBadge />}
                <ChevronRight aria-hidden className="size-5 shrink-0 text-(--tl-muted)" />
              </button>
            </li>
          ))}
          {guardian.children.length === 0 && (
            <li className="rounded-[16px] bg-(--tl-surface-sunk) px-4 py-3 text-[14px] text-(--tl-muted)">No Children yet.</li>
          )}
        </ul>

        <GuardianHomes guardian={guardian} />
      </DetailOverlay>
      <ActionsSheet
        isOpen={isMenuOpen}
        title={guardian.name}
        onClose={() => setIsMenuOpen(false)}
        actions={[
          { id: "edit", label: "Edit Guardian", icon: Pencil, description: "Name, WhatsApp number, Guardian language", onSelect: () => setIsEditing(true) },
          guardian.archived
            ? { id: "restore", label: "Restore", icon: ArchiveRestore, onSelect: () => { setGuardianArchived(guardian.id, false); showToast({ tone: "success", message: `${guardian.name} restored.` }); } }
            : { id: "archive", label: "Archive", icon: Archive, isDanger: true, description: "They can no longer use the bot", onSelect: () => setIsConfirmingArchive(true) },
        ]}
      />
      {isEditing && (
        <EditGuardianSheet
          guardian={guardian}
          onClose={() => setIsEditing(false)}
          onSave={(edit) => {
            updateGuardian(guardian.id, edit);
            setIsEditing(false);
            showToast({ tone: "success", message: "Guardian saved." });
          }}
        />
      )}
      <ConfirmDialog
        isOpen={isConfirmingArchive}
        onClose={() => setIsConfirmingArchive(false)}
        onConfirm={handleArchive}
        title={`Archive ${guardian.name}?`}
        confirmLabel="Archive"
        keepLabel="Keep"
        isDestructive
      >
        They can no longer use the bot. Their Children and Homes stay, and
        their Homes can still be booked for their Children. Restore brings
        them back.
      </ConfirmDialog>
    </>
  );
}
