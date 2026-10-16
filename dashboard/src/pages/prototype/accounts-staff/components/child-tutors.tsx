// A Child's Assigned Tutors on Child details (TutorLink#242): the Tutors
// and Managers the bot may book them with, each with what they cover of
// the Child's Subject levels. Set first by Mark Evaluated, and only
// editable once Evaluated; Admins and Managers change them here or from
// Staff details. Archiving a Tutor, or making them an Admin, removes the
// link, so a Child can be left with none: a Needs a Tutor callout.
import type { ReactNode } from "react";
import { Pencil, UserRoundPlus, UserRoundX } from "lucide-react";
import { CARD_TITLE, cn, EYEBROW } from "@/pages/prototype/shell-kit/kit/tokens";
import { Avatar } from "@/pages/prototype/shell-kit/kit/components/badges";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import {
  describeCoverage,
  needsTutor,
} from "@/pages/prototype/accounts-staff/lib/assigned-tutors";
import type { ChildDetail } from "@/pages/prototype/accounts-staff/types/api";

type ChildTutorsProps = { child: ChildDetail; onEdit: () => void };

export default function ChildTutors({ child, onEdit }: ChildTutorsProps): ReactNode {
  const { db } = useArea();
  const levels = child.levels.filter((item) => !item.archived);
  const tutors = child.assigned_tutors;
  const first = child.name.split(" ")[0];
  const canEdit = child.evaluated !== null && !child.archived;
  const isNeedy = needsTutor(child);

  const list = tutors.length > 0 && (
    <ul className="divide-y divide-(--tl-border) rounded-[18px] border border-(--tl-border) bg-(--tl-surface)">
      {tutors.map((tutor) => {
        const row = db.staff.find((item) => item.id === tutor.id);
        return (
          <li key={tutor.id} className="flex items-center gap-3 px-4 py-3">
            <Avatar name={tutor.name} />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                {tutor.name}
                {tutor.role === "manager" && <span className="text-[13px] font-normal text-(--tl-muted)">Manager</span>}
              </span>
              <span className="block text-[13px] text-(--tl-muted)">{row && describeCoverage(row, levels)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );

  let body: ReactNode;
  if (!child.evaluated) {
    // Clearing Evaluated keeps them; marking again replaces them.
    body = (
      <>
        <p className="mb-3 rounded-[16px] bg-(--tl-surface-sunk) px-4 py-3 text-[14px] text-(--tl-muted)">
          {tutors.length > 0
            ? "Kept from before. Mark Evaluated sets them again, and they can’t be changed until then."
            : "Set when you Mark Evaluated, after the Evaluation session. They can’t be changed until then."}
        </p>
        {list}
      </>
    );
  } else if (isNeedy) {
    body = (
      <section className="rounded-[18px] bg-(--tl-warning-tint) p-4 text-(--tl-warning)">
        <h4 className={cn(CARD_TITLE, "flex items-center gap-2")}>
          <UserRoundX aria-hidden className="size-[18px]" />
          Needs a Tutor
        </h4>
        <p className="mt-1 text-[14px] leading-5">
          {first} has no Assigned Tutors: the last was removed, archived or
          made an Admin. The bot hands every booking request to the office
          until you assign one. They’re in To do › Bookings.
        </p>
        {canEdit && (
          <Button variant="primary" icon={UserRoundPlus} className="mt-3" onClick={onEdit}>
            Assign Tutors
          </Button>
        )}
      </section>
    );
  } else {
    body = list;
  }

  return (
    <>
      <div className="mt-8 mb-3 flex items-center justify-between gap-3">
        <h3 className={EYEBROW}>
          {tutors.length > 0 ? `Assigned Tutors · ${tutors.length}` : "Assigned Tutors"}
        </h3>
        {canEdit && !isNeedy && (
          <Button variant="soft" icon={Pencil} onClick={onEdit}>
            Change
          </Button>
        )}
      </div>
      {body}
    </>
  );
}
