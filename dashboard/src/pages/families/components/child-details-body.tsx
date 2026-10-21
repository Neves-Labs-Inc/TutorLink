// Child details' body: identity, profile rows, Child notes, ticket 07's
// evaluation slot, the Guardians (each opens Guardian details stacked)
// and where the Child can be booked, read-only.
import type { ReactNode } from "react";
import { CalendarDays, Cake, GraduationCap, School } from "lucide-react";
import { DetailRow, NotesCard } from "@/components/kit/components/detail";
import {
  formatDateOfBirth,
  formatNextSession,
  formatOverallGrade,
  formatUpcomingCount,
} from "@/lib/families/child-labels";
import ChildEvaluationSlot from "@/pages/families/components/child-evaluation-slot";
import ChildPeople from "@/pages/families/components/child-people";
import { DetailsIdentity } from "@/pages/families/components/details-states";
import { SUNK_WELL } from "@/pages/families/lib/family-classes";
import type { ChildDetail } from "@/types/families";

const MISSING = "—";
const MUTED_VALUE = "text-(--tl-muted)";

type ChildDetailsBodyProps = {
  child: ChildDetail;
  onOpenGuardian: (guardianId: string) => void;
};

export default function ChildDetailsBody({
  child,
  onOpenGuardian,
}: ChildDetailsBodyProps): ReactNode {
  const dateOfBirth = formatDateOfBirth(child.date_of_birth);
  const next = child.next_session;
  return (
    <>
      <DetailsIdentity name={child.name} />
      <div className="mt-6 flex flex-col gap-5">
        <DetailRow icon={Cake} label="Date of birth">
          <ProfileValue value={dateOfBirth} />
        </DetailRow>
        <DetailRow icon={GraduationCap} label="Overall grade">
          <p className={child.grade_level === null ? MUTED_VALUE : "font-semibold"}>
            {formatOverallGrade(child.grade_level)}
          </p>
        </DetailRow>
        <DetailRow icon={School} label="School">
          <ProfileValue value={child.school_name.trim() || null} />
        </DetailRow>
        <DetailRow icon={CalendarDays} label="Next booking">
          {next ? (
            <>
              <p className="font-semibold tabular-nums">{formatNextSession(next)}</p>
              <p className="text-[13px] leading-[18px] text-(--tl-muted)">
                {formatUpcomingCount(child.upcoming_session_count)}
              </p>
            </>
          ) : (
            <p className={MUTED_VALUE}>Nothing booked</p>
          )}
        </DetailRow>
      </div>
      <div className="mt-6">
        {child.notes ? (
          <NotesCard>
            <p className="whitespace-pre-line">{child.notes}</p>
          </NotesCard>
        ) : (
          <p className={SUNK_WELL}>No Child notes yet</p>
        )}
      </div>
      <ChildEvaluationSlot child={child} />
      <ChildPeople child={child} onOpenGuardian={onOpenGuardian} />
    </>
  );
}

type ProfileValueProps = { value: string | null };

function ProfileValue({ value }: ProfileValueProps): ReactNode {
  return value === null ? (
    <p className={MUTED_VALUE}>{MISSING}</p>
  ) : (
    <p className="font-semibold">{value}</p>
  );
}
