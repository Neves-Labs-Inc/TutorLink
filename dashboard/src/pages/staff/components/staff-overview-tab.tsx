// Overview: contact, sign-in, this week and bio, then the Subjects a
// teaching profile covers, each with the highest grade they teach.
// Slots: `top` (the setup checklist) and `subjectsAction` (Edit
// subjects), both filled by the account acts.
import type { ReactNode } from "react";
import {
  BookOpen,
  CalendarDays,
  Mail,
  NotebookText,
  Phone,
  ShieldCheck,
} from "lucide-react";
import { DetailRow } from "@/components/kit/components/detail";
import { pluralize } from "@/components/kit/format";
import { EYEBROW } from "@/components/kit/tokens";
import { gradeName } from "@/lib/grades/grades";
import { formatPhoneForDisplay } from "@/lib/guardians/guardians";
import type { StaffRead } from "@/lib/queries/staff";
import { getSignInSentence } from "@/pages/staff/lib/staff-labels";

const SUNK_WELL =
  "rounded-[16px] bg-(--tl-surface-sunk) px-4 py-3 text-[14px] text-(--tl-muted)";

type StaffOverviewTabProps = {
  staff: StaffRead;
  top?: ReactNode;
  subjectsAction?: ReactNode;
};

export default function StaffOverviewTab({
  staff,
  top,
  subjectsAction,
}: StaffOverviewTabProps): ReactNode {
  const hasTeachingProfile = staff.tutor_id !== null;

  return (
    <>
      {top}
      <div className="flex flex-col gap-5">
        <DetailRow icon={Mail} label="Email">
          <p className="font-semibold break-all">{staff.email}</p>
        </DetailRow>
        {staff.phone_number && (
          <DetailRow icon={Phone} label="Phone">
            <p className="font-semibold tabular-nums">
              {formatPhoneForDisplay(staff.phone_number)}
            </p>
          </DetailRow>
        )}
        <DetailRow icon={ShieldCheck} label="Sign-in state">
          <p className="font-semibold">{getSignInSentence(staff)}</p>
        </DetailRow>
        <DetailRow icon={CalendarDays} label="This week">
          <p className="font-semibold tabular-nums">
            {pluralize(staff.sessions_this_week, "Booking", "Bookings")}
          </p>
        </DetailRow>
        {hasTeachingProfile && (
          <DetailRow icon={NotebookText} label="Bio">
            {staff.bio ? (
              <p className="whitespace-pre-line">{staff.bio}</p>
            ) : (
              <p className="text-(--tl-muted)">No bio yet</p>
            )}
          </DetailRow>
        )}
      </div>

      {hasTeachingProfile && (
        <>
          <div className="mt-8 mb-3 flex items-center justify-between gap-3">
            <h3 className={EYEBROW}>Subjects · {staff.subjects.length}</h3>
            {subjectsAction}
          </div>
          {staff.subjects.length === 0 ? (
            <p className={SUNK_WELL}>
              No Subjects yet, so the bot can’t offer them to Guardians.
            </p>
          ) : (
            <ul
              aria-label="Subjects"
              className="divide-y divide-(--tl-border) rounded-[16px] border border-(--tl-card-border) bg-(--tl-surface)"
            >
              {staff.subjects.map((subject) => (
                <li
                  key={subject.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <span className="flex min-w-0 items-center gap-2 text-[15px] font-semibold">
                    <BookOpen
                      aria-hidden
                      className="size-4 shrink-0 text-(--tl-muted)"
                    />
                    {subject.name}
                  </span>
                  <span className="shrink-0 text-[14px] text-(--tl-ink-soft)">
                    up to {gradeName(subject.max_grade_level)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
