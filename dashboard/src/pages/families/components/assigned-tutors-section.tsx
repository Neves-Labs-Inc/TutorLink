// Child details' Assigned Tutors (TutorLink#242): who the bot may book
// the Child with, each with what they cover of the Child's Subject
// levels. Mark Evaluated sets them first; only an Evaluated, live Child
// can change them. Archiving a Tutor (or making them an Admin) drops
// the link, so an Evaluated Child can be left with none: Needs a Tutor.
import { useId } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pencil, UserRoundPlus, UserRoundX } from "lucide-react";
import { Avatar } from "@/components/kit/components/badges";
import { Button } from "@/components/kit/components/button";
import { CARD_TITLE, cn, EYEBROW } from "@/components/kit/tokens";
import { getFirstName } from "@/lib/families/child-labels";
import { describeCoverage } from "@/lib/families/assigned-tutors";
import { assignedTutorQueries } from "@/lib/queries/assigned-tutors";
import { BORDERED_LIST, LIST_ROW } from "@/pages/families/lib/evaluation-classes";
import { SECTION_HEAD, SUNK_WELL } from "@/pages/families/lib/family-classes";
import type { AssignedTutorRead, ChildDetail, StaffRead } from "@/types/families";

type AssignedTutorsSectionProps = { child: ChildDetail; onEdit: () => void };

export default function AssignedTutorsSection({
  child,
  onEdit,
}: AssignedTutorsSectionProps): ReactNode {
  const headingId = useId();
  const tutors = child.assigned_tutors;
  const canEdit = child.evaluated !== null && !child.archived;
  const needsTutor = canEdit && tutors.length === 0;

  let body: ReactNode = <TutorList child={child} />;
  if (!child.evaluated) {
    // Clearing Evaluated keeps them; marking again replaces them.
    body = (
      <>
        <p className={cn(SUNK_WELL, "mb-3")}>
          {tutors.length > 0
            ? "Kept from before. Mark Evaluated sets them again, and they can’t be changed until then."
            : "Set when you Mark Evaluated, after the Evaluation session. They can’t be changed until then."}
        </p>
        {tutors.length > 0 && <TutorList child={child} />}
      </>
    );
  } else if (needsTutor) {
    body = <NeedsTutorCallout name={getFirstName(child.name)} onAssign={onEdit} />;
  } else if (tutors.length === 0) {
    // Archived with none: read-only, so no callout.
    body = <p className={SUNK_WELL}>No Assigned Tutors</p>;
  }

  return (
    <section aria-labelledby={headingId} className="mt-8">
      <div className={SECTION_HEAD}>
        <h3 id={headingId} className={EYEBROW}>
          {tutors.length > 0 ? `Assigned Tutors · ${tutors.length}` : "Assigned Tutors"}
        </h3>
        {canEdit && !needsTutor && (
          <Button variant="soft" icon={Pencil} onClick={onEdit}>
            Change
          </Button>
        )}
      </div>
      {body}
    </section>
  );
}

type TutorListProps = { child: ChildDetail };

function TutorList({ child }: TutorListProps): ReactNode {
  // Coverage needs each Tutor's Subjects; until they load, just names.
  const assignable = useQuery(assignedTutorQueries.assignable());
  const levels = child.levels.filter((level) => !level.archived);
  return (
    <ul className={cn(BORDERED_LIST, "kit-rise divide-y divide-(--tl-border)")}>
      {child.assigned_tutors.map((tutor) => (
        <TutorRow
          key={tutor.id}
          tutor={tutor}
          coverage={getCoverage(tutor, assignable.data, levels)}
        />
      ))}
    </ul>
  );
}

function getCoverage(
  tutor: AssignedTutorRead,
  staff: StaffRead[] | undefined,
  levels: ChildDetail["levels"],
): string | null {
  const row = staff?.find((person) => person.id === tutor.id);
  return row ? describeCoverage(row, levels) : null;
}

type TutorRowProps = { tutor: AssignedTutorRead; coverage: string | null };

function TutorRow({ tutor, coverage }: TutorRowProps): ReactNode {
  return (
    <li className={cn(LIST_ROW, "justify-start")}>
      <Avatar name={tutor.name} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 text-[15px] font-semibold">
          {tutor.name}
          {tutor.role === "manager" && (
            <span className="text-[13px] font-normal text-(--tl-muted)">Manager</span>
          )}
        </span>
        {coverage && (
          <span className="block text-[13px] text-(--tl-muted)">{coverage}</span>
        )}
      </span>
    </li>
  );
}

type NeedsTutorCalloutProps = { name: string; onAssign: () => void };

function NeedsTutorCallout({ name, onAssign }: NeedsTutorCalloutProps): ReactNode {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-[16px] bg-(--tl-warning-tint) p-4 text-(--tl-warning)"
    >
      <h4 id={headingId} className={cn(CARD_TITLE, "flex items-center gap-2")}>
        <UserRoundX aria-hidden className="size-[18px]" />
        Needs a Tutor
      </h4>
      <p className="mt-1 text-[14px] leading-5">
        {name} has no Assigned Tutors. The bot hands every booking request to
        the office until you assign one. They’re in To do.
      </p>
      <Button
        variant="primary"
        icon={UserRoundPlus}
        className="mt-3 w-full @md:w-auto"
        onClick={onAssign}
      >
        Assign Tutors
      </Button>
    </section>
  );
}
