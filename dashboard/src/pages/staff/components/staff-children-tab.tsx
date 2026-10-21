// Staff details › Children (TutorLink#242): the Children a Tutor or
// Manager is an Assigned Tutor of, each opening the Child in its family.
// Admins and Managers change the list here (the one thing Managers may
// change on Staff); it's the same link as Assigned Tutors on the Child.
import { useState } from "react";
import type { ReactNode } from "react";
import { Info, Pencil } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  ArchivedBadge,
  Avatar,
  Badge,
} from "@/components/kit/components/badges";
import { Button } from "@/components/kit/components/button";
import { ListRow } from "@/components/kit/components/list-row";
import { InlineError, ListSkeleton } from "@/components/kit/states/states";
import { EYEBROW } from "@/components/kit/tokens";
import { familyChildPath } from "@/lib/families/family-paths";
import type { EvaluatedChild } from "@/lib/queries/assigned-children";
import type { StaffRead } from "@/lib/queries/staff";
import AssignedChildrenSheet from "@/pages/staff/components/assigned-children-sheet";
import { useAssignedChildren } from "@/pages/staff/hooks/use-assigned-children";
import {
  describeChild,
  getFirstName,
  isOnlyTutor,
} from "@/pages/staff/lib/assigned-children";

const MAX_SKELETON_ROWS = 3;
const EMPTY_SKELETON_ROWS = 2;

function getInfoLine(staff: StaffRead): string {
  const first = getFirstName(staff.name);
  return staff.archived
    ? `Archiving ${first} removed them as an Assigned Tutor. Restore doesn’t bring that back: after Restore, assign them again here.`
    : `The bot may book these Children with ${first}, for the Subject levels ${first} covers. ${first} doesn’t see this list.`;
}

type ChildCardsProps = { items: EvaluatedChild[]; staff: StaffRead };

function ChildCards({ items, staff }: ChildCardsProps): ReactNode {
  const navigate = useNavigate();
  if (items.length === 0) {
    return (
      <p className="rounded-[16px] bg-(--tl-surface-sunk) px-4 py-3 text-[14px] text-(--tl-muted)">
        Not an Assigned Tutor of any Child yet.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {items.map((child) => (
        <li key={child.id}>
          <ListRow
            leading={<Avatar name={child.name} />}
            title={child.name}
            subtitle={describeChild(child, staff)}
            badges={
              child.archived ? (
                <ArchivedBadge />
              ) : (
                isOnlyTutor(child, staff.id) && (
                  <Badge tone="yellow">Only Assigned Tutor</Badge>
                )
              )
            }
            isMuted={child.archived}
            onOpen={() => navigate(familyChildPath(child.id, child.id))}
          />
        </li>
      ))}
    </ul>
  );
}

type StaffChildrenTabProps = {
  staff: StaffRead;
  canEditChildren: boolean;
};

export default function StaffChildrenTab({
  staff,
  canEditChildren,
}: StaffChildrenTabProps): ReactNode {
  const assigned = useAssignedChildren(staff);
  const [isEditing, setIsEditing] = useState(false);
  // A fresh sheet per open, so it seeds its ticks from the latest list.
  const [sheetKey, setSheetKey] = useState(0);

  function handleChange(): void {
    setSheetKey((key) => key + 1);
    setIsEditing(true);
  }

  let body: ReactNode;
  if (assigned.hasFailed) {
    body = (
      <InlineError
        message="Couldn’t load their Children. Check your connection and try again."
        onRetry={assigned.retry}
        isRetrying={assigned.isRetrying}
      />
    );
  } else if (!assigned.children) {
    body = (
      <ListSkeleton
        rows={Math.min(assigned.liveCount, MAX_SKELETON_ROWS) || EMPTY_SKELETON_ROWS}
        label="Loading assigned Children"
      />
    );
  } else {
    body = <ChildCards items={assigned.children} staff={staff} />;
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className={EYEBROW}>Assigned Children · {assigned.liveCount}</h3>
        {canEditChildren && (
          <Button variant="soft" icon={Pencil} onClick={handleChange}>
            Change
          </Button>
        )}
      </div>
      <p className="mb-4 flex items-start gap-2 text-[14px] leading-5 text-(--tl-ink-soft)">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-(--tl-muted)" />
        {getInfoLine(staff)}
      </p>
      {body}
      {canEditChildren && sheetKey > 0 && (
        <AssignedChildrenSheet
          key={sheetKey}
          isOpen={isEditing}
          staff={staff}
          onClose={() => setIsEditing(false)}
        />
      )}
    </>
  );
}
