// Child details over the family page: profile, Child notes, Guardians
// (each opens Guardian details stacked) and where they can be booked,
// with Book evaluation / New booking in the footer. Edit details, Change
// guardians and Archive / Restore sit under ⋯. Other areas open it
// through familyChildPath; keep these props.
import { useState } from "react";
import type { ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Pencil,
  Users,
} from "lucide-react";
import { ArchivedBadge } from "@/components/kit/components/badges";
import { IconButton } from "@/components/kit/components/button";
import { ActionsSheet } from "@/components/kit/overlays/actions-sheet";
import type { SheetAction } from "@/components/kit/overlays/actions-sheet";
import { DetailOverlay } from "@/components/kit/overlays/detail-overlay";
import { InlineError } from "@/components/kit/states/states";
import type { Family } from "@/hooks/use-family";
import { errorStatus } from "@/lib/api";
import { formatUpcomingCount } from "@/lib/families/child-labels";
import ArchiveChildDialog from "@/pages/families/components/archive-child-dialog";
import ChildBookButton from "@/pages/families/components/child-book-button";
import ChildDetailsBody from "@/pages/families/components/child-details-body";
import ChildGuardiansSheet from "@/pages/families/components/child-guardians-sheet";
import {
  DetailsHeaderSkeleton,
  DetailsSkeleton,
} from "@/pages/families/components/details-states";
import EditChildSheet from "@/pages/families/components/edit-child-sheet";
import { useChildArchive } from "@/pages/families/hooks/use-child-archive";
import type { ChildArchive } from "@/pages/families/hooks/use-child-archive";
import { useFamilyDetails } from "@/pages/families/hooks/use-family-details";
import { SUNK_WELL } from "@/pages/families/lib/family-classes";
import type { ChildDetail } from "@/types/families";

const NOT_FOUND = 404;

type ChildDetailsOverlayProps = {
  childId: string;
  family: Family;
  isOpen: boolean;
  backLabel: string;
  onBack: () => void;
  onClose: () => void;
};

export default function ChildDetailsOverlay({
  childId,
  family,
  isOpen,
  backLabel,
  onBack,
  onClose,
}: ChildDetailsOverlayProps): ReactNode {
  const { openGuardian } = useFamilyDetails();
  const member = family.children.find((child) => child.id === childId);
  const detail = member?.detail;
  const child = detail?.data;
  const archive = useChildArchive(childId, child);
  const [sheet, setSheet] = useState<Sheet>(null);
  // A fresh Edit form per open, starting from the Child as saved.
  const [editKey, setEditKey] = useState(0);
  const isNotInFamily =
    (family.household.isSuccess && !member) ||
    errorStatus(detail?.error) === NOT_FOUND;
  const hasFailed = !child && !isNotInFamily && detail?.isError === true;
  const closeSheet = () => setSheet(null);

  let header: ReactNode = <span />;
  let body: ReactNode = <DetailsSkeleton label="Loading Child details" />;
  if (child) {
    header = (
      <>
        <ChildBadge child={child} isRestoring={archive.isRestoring} />
        <IconButton
          icon={MoreHorizontal}
          label="More actions"
          onClick={() => setSheet("menu")}
        />
      </>
    );
    body = <ChildDetailsBody child={child} onOpenGuardian={openGuardian} />;
  } else if (isNotInFamily) {
    body = <p className={SUNK_WELL}>This Child isn’t in this family.</p>;
  } else if (hasFailed) {
    body = (
      <InlineError
        message="Couldn’t load Child details. Check your connection."
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
        title={child?.name ?? "Child details"}
        backLabel={backLabel}
        phoneMode="page"
        header={
          <div className="flex min-h-11 items-center justify-between gap-2">
            {header}
          </div>
        }
        footer={child && !child.archived && <ChildBookButton child={child} />}
      >
        {body}
      </DetailOverlay>
      {child && (
        <>
          <ActionsSheet
            isOpen={sheet === "menu"}
            title={child.name}
            actions={getActions(child, archive, {
              onEdit: () => {
                setEditKey((key) => key + 1);
                setSheet("edit");
              },
              onGuardians: () => setSheet("guardians"),
            })}
            onClose={closeSheet}
          />
          <EditChildSheet
            key={editKey}
            child={child}
            isOpen={sheet === "edit"}
            onClose={closeSheet}
          />
          <ChildGuardiansSheet
            child={child}
            isOpen={sheet === "guardians"}
            onClose={closeSheet}
          />
          <ArchiveChildDialog child={child} archive={archive} />
        </>
      )}
    </>
  );
}

type Sheet = "menu" | "edit" | "guardians" | null;

type ChildBadgeProps = { child: ChildDetail; isRestoring: boolean };

// Archived, or nothing; a stand-in while a Restore runs.
function ChildBadge({ child, isRestoring }: ChildBadgeProps): ReactNode {
  let badge: ReactNode = <span />;
  if (isRestoring) {
    badge = <DetailsHeaderSkeleton />;
  } else if (child.archived) {
    badge = <ArchivedBadge />;
  }
  return badge;
}

type MenuHandlers = { onEdit: () => void; onGuardians: () => void };

function getActions(
  child: ChildDetail,
  archive: ChildArchive,
  { onEdit, onGuardians }: MenuHandlers,
): SheetAction[] {
  const upcoming = child.upcoming_session_count;
  const archiveAction: SheetAction = child.archived
    ? {
        id: "restore",
        label: "Restore",
        icon: ArchiveRestore,
        description: "Cancelled Bookings stay cancelled",
        onSelect: archive.restore,
      }
    : {
        id: "archive",
        label: "Archive",
        icon: Archive,
        isDanger: true,
        description:
          upcoming > 0 ? `Cancels ${formatUpcomingCount(upcoming)}` : undefined,
        onSelect: archive.askToArchive,
      };
  return [
    {
      id: "edit",
      label: "Edit details",
      icon: Pencil,
      description: "Name, birthday, grade, school, Child notes",
      onSelect: onEdit,
    },
    {
      id: "guardians",
      label: "Change guardians",
      icon: Users,
      description: "Link or unlink Guardians",
      onSelect: onGuardians,
    },
    archiveAction,
  ];
}
