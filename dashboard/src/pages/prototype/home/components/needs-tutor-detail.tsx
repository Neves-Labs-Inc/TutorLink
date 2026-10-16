// What a Needs a Tutor row opens (TutorLink#242): the Child's details,
// with the reason on top and Assign Tutors in the footer. A stand-in for
// the Families Child details (prototype/accounts-staff ?screen=
// child-no-tutor), cut down to what this job needs. Assigning at least
// one Tutor takes the Child off To do.
import { useState } from "react";
import type { ReactNode } from "react";
import {
  BadgeCheck,
  BookOpen,
  UserRoundPlus,
  UserRoundX,
  Users,
} from "lucide-react";
import { Badge } from "@/pages/prototype/shell-kit/kit/components/badges";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import { CheckboxField } from "@/pages/prototype/shell-kit/kit/components/choices";
import { DetailRow } from "@/pages/prototype/shell-kit/kit/components/detail";
import { BottomSheet } from "@/pages/prototype/shell-kit/kit/overlays/bottom-sheet";
import { DetailOverlay } from "@/pages/prototype/shell-kit/kit/overlays/detail-overlay";
import { CARD_TITLE, cn } from "@/pages/prototype/shell-kit/kit/tokens";
import PrototypeNote from "@/pages/prototype/home/components/prototype-note";
import { formatDate, formatLevels } from "@/pages/prototype/home/lib/labels";
import { ASSIGNABLE } from "@/pages/prototype/home/lib/mock-api";
import type { AssignableStaff, ChildSummary } from "@/pages/prototype/home/types/api";

function getFirstName(name: string): string {
  return name.split(" ")[0];
}

function describeCoverage(staff: AssignableStaff, child: ChildSummary): string {
  const covers = (level: ChildSummary["levels"][number]): boolean =>
    staff.subjects.some(
      (subject) => subject.subject_id === level.subject_id && subject.max_grade_level >= level.level,
    );
  const covered = child.levels.filter(covers).map((level) => level.name);
  const missed = child.levels.filter((level) => !covers(level)).map((level) => level.name);
  if (missed.length === 0) return `Covers ${covered.join(", ")}`;
  if (covered.length === 0) return `Doesn’t cover ${missed.join(", ")}`;
  return `Covers ${covered.join(", ")} · not ${missed.join(", ")}`;
}

type NeedsTutorDetailProps = {
  child: ChildSummary | null;
  startsAssigning?: boolean;
  onClose: () => void;
  onAssigned: (child: ChildSummary, staff: AssignableStaff[]) => void;
};

export default function NeedsTutorDetail({
  child,
  startsAssigning = false,
  onClose,
  onAssigned,
}: NeedsTutorDetailProps): ReactNode {
  const [isAssigning, setIsAssigning] = useState(startsAssigning);
  const first = child ? getFirstName(child.name) : "";

  return (
    <>
      <DetailOverlay
        isOpen={child !== null}
        onClose={onClose}
        title={child ? `Child: ${child.name}` : "Child"}
        backLabel="Home"
        phoneMode="page"
        header={
          child && (
            <div className="flex flex-col gap-2">
              <Badge tone="warning" icon={UserRoundX}>
                Needs a Tutor
              </Badge>
              <h2 className="kit-display text-[22px] leading-[30px] font-bold">{child.name}</h2>
            </div>
          )
        }
        footer={
          child && (
            <Button variant="primary" icon={UserRoundPlus} onClick={() => setIsAssigning(true)}>
              Assign Tutors
            </Button>
          )
        }
      >
        {child && (
          <div className="flex flex-col gap-5 pt-3">
            <section className="rounded-[18px] bg-(--tl-warning-tint) p-4 text-(--tl-warning)">
              <h3 className={cn(CARD_TITLE, "flex items-center gap-2")}>
                <UserRoundX aria-hidden className="size-[18px]" />
                No Assigned Tutor
              </h3>
              <p className="mt-1 text-[14px] leading-5">
                {first}’s last Assigned Tutor was removed, archived or made an
                Admin. The bot hands every booking request to the office until
                you assign one.
              </p>
            </section>
            <DetailRow icon={BookOpen} label="Subject levels">
              {formatLevels(child)}
            </DetailRow>
            {child.evaluated && (
              <DetailRow icon={BadgeCheck} label="Evaluated">
                {formatDate(child.evaluated.at.slice(0, 10), { month: "short", day: "numeric", year: "numeric" })} by{" "}
                {child.evaluated.by.name}
              </DetailRow>
            )}
            <DetailRow icon={Users} label="Guardians">
              {child.guardians.map((guardian) => guardian.name).join(", ")}
            </DetailRow>
            <PrototypeNote>
              Stands in for the Child’s details in Families
              (/prototype/accounts-staff?screen=child-no-tutor), which the real
              row opens.
            </PrototypeNote>
          </div>
        )}
      </DetailOverlay>
      {child && isAssigning && (
        <AssignSheet
          child={child}
          onClose={() => setIsAssigning(false)}
          onSave={(staff) => {
            setIsAssigning(false);
            onAssigned(child, staff);
          }}
        />
      )}
    </>
  );
}

type AssignSheetProps = {
  child: ChildSummary;
  onClose: () => void;
  onSave: (staff: AssignableStaff[]) => void;
};

function AssignSheet({ child, onClose, onSave }: AssignSheetProps): ReactNode {
  const [selected, setSelected] = useState<string[]>([]);
  const [showsError, setShowsError] = useState(false);
  const picked = ASSIGNABLE.filter((staff) => selected.includes(staff.id));

  return (
    <BottomSheet
      isOpen
      onClose={onClose}
      title="Assign Tutors"
      description={`Who the bot may book ${getFirstName(child.name)} with. Admins can’t be Assigned Tutors.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => (picked.length === 0 ? setShowsError(true) : onSave(picked))}
          >
            Assign
          </Button>
        </>
      }
    >
      <ul className="flex flex-col">
        {ASSIGNABLE.map((staff) => (
          <li key={staff.id}>
            <CheckboxField
              label={staff.role === "manager" ? `${staff.name} · Manager` : staff.name}
              description={describeCoverage(staff, child)}
              isChecked={selected.includes(staff.id)}
              onChange={(isChecked) =>
                setSelected((current) =>
                  isChecked ? [...current, staff.id] : current.filter((id) => id !== staff.id),
                )
              }
            />
          </li>
        ))}
      </ul>
      {showsError && picked.length === 0 && (
        <p className="mt-2 px-1 text-[13px] font-medium text-(--tl-danger)">Pick at least one Tutor.</p>
      )}
    </BottomSheet>
  );
}
