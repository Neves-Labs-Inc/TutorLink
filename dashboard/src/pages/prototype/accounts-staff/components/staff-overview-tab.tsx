// Overview: the setup checklist while anything is left, then contact,
// sign-in, bio and Subjects (each with the highest grade they teach).
import { useState } from "react";
import type { ReactNode } from "react";
import {
  BookOpen,
  CalendarDays,
  Mail,
  NotebookText,
  Pencil,
  Phone,
  ShieldCheck,
} from "lucide-react";
import { cn, EYEBROW } from "@/pages/prototype/shell-kit/kit/tokens";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import { DetailRow } from "@/pages/prototype/shell-kit/kit/components/detail";
import SetupChecklist from "@/pages/prototype/accounts-staff/components/setup-checklist";
import SubjectsSheet from "@/pages/prototype/accounts-staff/components/subjects-sheet";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import {
  formatGrade,
  formatPhone,
  formatShortDate,
} from "@/pages/prototype/accounts-staff/lib/labels";
import {
  listAvailability,
  readTutor,
} from "@/pages/prototype/accounts-staff/lib/mock-api";
import { NOW_ISO } from "@/pages/prototype/accounts-staff/lib/mock-data";
import type { StaffPermissions } from "@/pages/prototype/accounts-staff/lib/staff-rules";
import type { StaffRead } from "@/pages/prototype/accounts-staff/types/api";

type StaffOverviewTabProps = {
  staff: StaffRead;
  can: StaffPermissions;
  onGoTo: (tab: "availability") => void;
  onInvite: () => void;
};

function getSignInDetail(staff: StaffRead): string {
  if (staff.sign_in_state === "active") return "Active: has chosen a password";
  if (staff.sign_in_state === "not_invited") return "Not invited: can’t sign in yet";
  const expires = staff.invite_expires_at;
  if (expires && expires < NOW_ISO) return `Invited. The Invite expired ${formatShortDate(expires)}; send it again.`;
  return expires ? `Invited. The Invite lasts until ${formatShortDate(expires)}.` : "Invited";
}

export default function StaffOverviewTab({
  staff,
  can,
  onGoTo,
  onInvite,
}: StaffOverviewTabProps): ReactNode {
  const { db } = useArea();
  const [isSubjectsOpen, setIsSubjectsOpen] = useState(false);
  const tutor = readTutor(db, staff.id);
  const slotCount = staff.tutor_id ? listAvailability(db, staff.tutor_id).length : 0;

  return (
    <>
      {!staff.archived && (
        <SetupChecklist
          staff={staff}
          slotCount={slotCount}
          can={can}
          onAddSubjects={() => setIsSubjectsOpen(true)}
          onOpenAvailability={() => onGoTo("availability")}
          onInvite={onInvite}
        />
      )}
      <div className="flex flex-col gap-5">
        <DetailRow icon={Mail} label="Email">
          <p className="font-semibold break-all">{staff.email}</p>
        </DetailRow>
        {tutor && (
          <DetailRow icon={Phone} label="Phone">
            <p className="font-semibold tabular-nums">{formatPhone(tutor.phone_number)}</p>
          </DetailRow>
        )}
        <DetailRow icon={ShieldCheck} label="Sign-in state">
          <p className="font-semibold">{getSignInDetail(staff)}</p>
        </DetailRow>
        <DetailRow icon={CalendarDays} label="This week">
          <p className="font-semibold tabular-nums">
            {staff.sessions_this_week} {staff.sessions_this_week === 1 ? "Booking" : "Bookings"}
          </p>
        </DetailRow>
        {tutor && (
          <DetailRow icon={NotebookText} label="Bio">
            <p className={tutor.bio ? "" : "text-(--tl-muted)"}>{tutor.bio ?? "No bio yet"}</p>
          </DetailRow>
        )}
      </div>

      {tutor && (
        <>
          <div className="mt-8 mb-3 flex items-center justify-between gap-3">
            <h3 className={EYEBROW}>Subjects · {tutor.subjects.length}</h3>
            {can.canEditTeaching && (
              <Button variant="soft" icon={Pencil} onClick={() => setIsSubjectsOpen(true)}>
                Edit subjects
              </Button>
            )}
          </div>
          {tutor.subjects.length === 0 ? (
            <p className="rounded-[16px] bg-(--tl-surface-sunk) px-4 py-3 text-[14px] text-(--tl-muted)">
              No Subjects yet, so the bot can’t offer them to Guardians.
            </p>
          ) : (
            <ul className="divide-y divide-(--tl-border) rounded-[18px] border border-(--tl-border) bg-(--tl-surface)">
              {tutor.subjects.map((subject) => (
                <li key={subject.subject_id} className={cn("flex items-center justify-between gap-3 px-4 py-3")}>
                  <span className="flex items-center gap-2 text-[15px] font-semibold">
                    <BookOpen aria-hidden className="size-4 text-(--tl-muted)" />
                    {subject.name}
                  </span>
                  <span className="text-[14px] text-(--tl-ink-soft)">up to {formatGrade(subject.max_grade_level)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {isSubjectsOpen && tutor && (
        <SubjectsSheet staffId={staff.id} subjects={tutor.subjects} onClose={() => setIsSubjectsOpen(false)} />
      )}
    </>
  );
}
