// Guardian details over the family page: contact, Guardian language,
// Booking reminders, their Children (each opens Child details stacked)
// and their Homes (read-only), with Open chat in the footer. Edit,
// Booking reminders and Archive / Restore sit under ⋯. Chats links in
// through familyGuardianPath; keep these props.
import { useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  BellRing,
  MessageCircle,
  MoreHorizontal,
  Pencil,
} from "lucide-react";
import { ArchivedBadge, RemindersBadge } from "@/components/kit/components/badges";
import { Button, IconButton } from "@/components/kit/components/button";
import { ActionsSheet } from "@/components/kit/overlays/actions-sheet";
import type { SheetAction } from "@/components/kit/overlays/actions-sheet";
import { DetailOverlay } from "@/components/kit/overlays/detail-overlay";
import { ConfirmDialog } from "@/components/kit/overlays/dialog";
import { InlineError } from "@/components/kit/states/states";
import type { Family } from "@/hooks/use-family";
import { errorStatus } from "@/lib/api";
import { describeCascade } from "@/lib/families/guardian-archive";
import { getRemindersLabel } from "@/lib/families/guardian-labels";
import {
  DetailsHeaderSkeleton,
  DetailsSkeleton,
} from "@/pages/families/components/details-states";
import EditGuardianSheet from "@/pages/families/components/edit-guardian-sheet";
import GuardianDetailsBody from "@/pages/families/components/guardian-details-body";
import GuardianRemindersSheet from "@/pages/families/components/guardian-reminders-sheet";
import { useFamilyDetails } from "@/pages/families/hooks/use-family-details";
import { useGuardianArchive } from "@/pages/families/hooks/use-guardian-archive";
import type { GuardianArchive } from "@/pages/families/hooks/use-guardian-archive";
import { SUNK_WELL } from "@/pages/families/lib/family-classes";
import type { ClientRead } from "@/types/families";

const NOT_FOUND = 404;

type GuardianDetailsOverlayProps = {
  guardianId: string;
  family: Family;
  isOpen: boolean;
  backLabel: string;
  onBack: () => void;
  onClose: () => void;
};

export default function GuardianDetailsOverlay({
  guardianId,
  family,
  isOpen,
  backLabel,
  onBack,
  onClose,
}: GuardianDetailsOverlayProps): ReactNode {
  const navigate = useNavigate();
  const { openChild } = useFamilyDetails();
  const member = family.guardians.find((guardian) => guardian.id === guardianId);
  const detail = member?.detail;
  const guardian = detail?.data;
  const archive = useGuardianArchive(family, guardianId, guardian);
  const [sheet, setSheet] = useState<Sheet>(null);
  // A fresh Edit form per open, starting from the Guardian as saved.
  const [editKey, setEditKey] = useState(0);
  const isNotInFamily =
    (family.household.isSuccess && !member) ||
    errorStatus(detail?.error) === NOT_FOUND;
  const hasFailed = !guardian && !isNotInFamily && detail?.isError === true;
  const chatId = guardian?.language_conversation_id ?? null;
  const closeSheet = () => setSheet(null);

  let header: ReactNode = <span />;
  let body: ReactNode = <DetailsSkeleton label="Loading Guardian details" />;
  if (guardian) {
    header = (
      <>
        <GuardianBadge guardian={guardian} isRestoring={archive.isRestoring} />
        <IconButton
          icon={MoreHorizontal}
          label="More actions"
          onClick={() => setSheet("menu")}
        />
      </>
    );
    body = <GuardianDetailsBody guardian={guardian} onOpenChild={openChild} />;
  } else if (isNotInFamily) {
    body = <p className={SUNK_WELL}>This Guardian isn’t in this family.</p>;
  } else if (hasFailed) {
    body = (
      <InlineError
        message="Couldn’t load Guardian details. Check your connection."
        onRetry={() => void detail.refetch()}
        isRetrying={detail.isFetching}
      />
    );
  } else {
    header = <DetailsHeaderSkeleton />;
  }

  return (
    <>
      <DetailOverlay
        isOpen={isOpen}
        onClose={onClose}
        onBack={onBack}
        title={guardian?.name ?? "Guardian details"}
        backLabel={backLabel}
        phoneMode="page"
        header={
          <div className="flex min-h-11 items-center justify-between gap-2">
            {header}
          </div>
        }
        footer={
          chatId !== null && (
            <Button
              variant="primary"
              icon={MessageCircle}
              isFullWidth
              onClick={() => navigate(`/chats/${chatId}`)}
            >
              Open chat
            </Button>
          )
        }
      >
        {body}
      </DetailOverlay>
      {guardian && (
        <>
          <ActionsSheet
            isOpen={sheet === "menu"}
            title={guardian.name}
            actions={getActions(guardian, archive, {
              onEdit: () => {
                setEditKey((key) => key + 1);
                setSheet("edit");
              },
              onReminders: () => setSheet("reminders"),
            })}
            onClose={closeSheet}
          />
          <EditGuardianSheet
            key={editKey}
            guardian={guardian}
            isOpen={sheet === "edit"}
            onClose={closeSheet}
          />
          <GuardianRemindersSheet
            guardian={guardian}
            isOpen={sheet === "reminders"}
            onClose={closeSheet}
          />
          <ArchiveGuardianDialog name={guardian.name} archive={archive} />
        </>
      )}
    </>
  );
}

type Sheet = "menu" | "edit" | "reminders" | null;

type GuardianBadgeProps = { guardian: ClientRead; isRestoring: boolean };

// Reminders state, or Archived; a stand-in while a Restore runs.
function GuardianBadge({ guardian, isRestoring }: GuardianBadgeProps): ReactNode {
  let badge: ReactNode = (
    <RemindersBadge state={getRemindersLabel(guardian.reminders)} />
  );
  if (isRestoring) {
    badge = <DetailsHeaderSkeleton />;
  } else if (guardian.archived) {
    badge = <ArchivedBadge />;
  }
  return badge;
}

type MenuHandlers = { onEdit: () => void; onReminders: () => void };

function getActions(
  guardian: ClientRead,
  archive: GuardianArchive,
  { onEdit, onReminders }: MenuHandlers,
): SheetAction[] {
  const archiveAction: SheetAction = guardian.archived
    ? {
        id: "restore",
        label: "Restore",
        icon: ArchiveRestore,
        onSelect: archive.restore,
      }
    : {
        id: "archive",
        label: "Archive",
        icon: Archive,
        isDanger: true,
        description: "They can no longer use the bot",
        onSelect: archive.askToArchive,
      };
  return [
    {
      id: "edit",
      label: "Edit Guardian",
      icon: Pencil,
      description: "Name, WhatsApp number, Guardian language",
      onSelect: onEdit,
    },
    {
      id: "reminders",
      label: "Booking reminders",
      icon: BellRing,
      description: getRemindersLabel(guardian.reminders),
      onSelect: onReminders,
    },
    archiveAction,
  ];
}

type ArchiveGuardianDialogProps = { name: string; archive: GuardianArchive };

function ArchiveGuardianDialog({
  name,
  archive,
}: ArchiveGuardianDialogProps): ReactNode {
  const cascadeLine = describeCascade(archive.cascade);
  return (
    <ConfirmDialog
      isOpen={archive.isConfirming}
      onClose={archive.cancelArchive}
      onConfirm={archive.archive}
      title={`Archive ${name}?`}
      confirmLabel="Archive guardian"
      keepLabel="Keep guardian"
      isDestructive
      isWorking={archive.isArchiving}
    >
      <p>They can no longer use the bot.</p>
      {cascadeLine && <p className="mt-2">{cascadeLine}</p>}
    </ConfirmDialog>
  );
}
