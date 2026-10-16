// Staff details › Children (TutorLink#242): the Children a Tutor or
// Manager is an Assigned Tutor of, each opening the Child in its family.
// Admins and Managers both change the list here; it's the same link as
// Assigned Tutors on the Child. Tutors never see this list.
import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronRight, Info, Pencil } from "lucide-react";
import { CARD, cn, EYEBROW } from "@/pages/prototype/shell-kit/kit/tokens";
import { ArchivedBadge, Avatar, Badge } from "@/pages/prototype/shell-kit/kit/components/badges";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import AssignedChildrenSheet from "@/pages/prototype/accounts-staff/components/assigned-children-sheet";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import { describeCoverage } from "@/pages/prototype/accounts-staff/lib/assigned-tutors";
import { getFamilyTitle } from "@/pages/prototype/accounts-staff/lib/labels";
import { listAssignedChildren } from "@/pages/prototype/accounts-staff/lib/mock-api";
import type { StaffRead } from "@/pages/prototype/accounts-staff/types/api";

type StaffChildrenTabProps = {
  staff: StaffRead;
  onOpenChild: (childId: string) => void;
};

export default function StaffChildrenTab({ staff, onOpenChild }: StaffChildrenTabProps): ReactNode {
  const { db } = useArea();
  const [isEditing, setIsEditing] = useState(false);
  const row = db.staff.find((item) => item.id === staff.id);
  const items = listAssignedChildren(db, staff.id);
  const first = staff.name.split(" ")[0];
  const canEdit = !staff.archived;
  const liveCount = items.filter((child) => !child.archived).length;

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className={EYEBROW}>Assigned Children · {liveCount}</h3>
        {canEdit && (
          <Button variant="soft" icon={Pencil} onClick={() => setIsEditing(true)}>
            Change
          </Button>
        )}
      </div>
      <p className="mb-4 flex items-start gap-2 text-[14px] leading-5 text-(--tl-ink-soft)">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-(--tl-muted)" />
        {staff.archived
          ? `Archiving ${first} removed them as an Assigned Tutor. Restore doesn’t bring that back: after Restore, assign them again here.`
          : `The bot may book these Children with ${first}, for the Subject levels ${first} covers. ${first} doesn’t see this list.`}
      </p>
      {items.length === 0 ? (
        <p className="rounded-[16px] bg-(--tl-surface-sunk) px-4 py-3 text-[14px] text-(--tl-muted)">
          Not an Assigned Tutor of any Child yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((child) => {
            const isOnly = !child.archived && child.assigned_tutors.length === 1;
            return (
              <li key={child.id}>
                <button
                  type="button"
                  onClick={() => onOpenChild(child.id)}
                  aria-label={`Open ${child.name} in their family`}
                  className={cn(
                    CARD,
                    "flex min-h-[72px] w-full cursor-pointer items-center gap-3 p-4 text-left transition-colors duration-150 hover:border-(--tl-hero)",
                    child.archived && "text-(--tl-muted)",
                  )}
                >
                  <Avatar name={child.name} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                      {child.name}
                      {child.archived && <ArchivedBadge />}
                      {isOnly && <Badge tone="yellow">Only Assigned Tutor</Badge>}
                    </span>
                    <span className="block text-[13px] text-(--tl-muted)">
                      {getFamilyTitle(child.guardians, [child])}
                      {row && ` · ${describeCoverage(row, child.levels)}`}
                    </span>
                  </span>
                  <ChevronRight aria-hidden className="size-5 shrink-0 text-(--tl-muted)" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {isEditing && row && (
        <AssignedChildrenSheet staff={row} onClose={() => setIsEditing(false)} />
      )}
    </>
  );
}
