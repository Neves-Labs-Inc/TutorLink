// Pick a Child's Assigned Tutors (TutorLink#242): every live Tutor and
// Manager (never an Admin), each with what they cover of `levels`, then
// a note for any level none of the picks covers. It loads the list
// itself (assignedTutorQueries.assignable), so Families and Staff ›
// Children drop it into a sheet as is.
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { CheckboxField } from "@/components/kit/components/choices";
import { InlineError, Skeleton } from "@/components/kit/states/states";
import { gradeName } from "@/lib/grades/grades";
import { describeCoverage, uncoveredLevels } from "@/lib/families/assigned-tutors";
import type { CoverageLevel } from "@/lib/families/assigned-tutors";
import { joinNames } from "@/lib/families/guardian-archive";
import { assignedTutorQueries } from "@/lib/queries/assigned-tutors";

const SKELETON_ROWS = 3;
const NOTE =
  "rounded-[16px] bg-(--tl-surface-sunk) px-4 py-3 text-[14px] leading-5 text-(--tl-muted)";

type AssignedTutorsPickerProps = {
  levels: CoverageLevel[];
  selected: string[];
  onChange: (ids: string[]) => void;
  error?: string;
};

export function AssignedTutorsPicker({
  levels,
  selected,
  onChange,
  error,
}: AssignedTutorsPickerProps): ReactNode {
  const assignable = useQuery(assignedTutorQueries.assignable());

  const staff = assignable.data ?? [];
  const picked = staff.filter((person) => selected.includes(person.id));
  const uncovered = picked.length > 0 ? uncoveredLevels(levels, picked) : [];

  let list: ReactNode = <PickerSkeleton />;
  if (assignable.data) {
    list =
      staff.length === 0 ? (
        <p className={NOTE}>No active Tutors or Managers yet</p>
      ) : (
        <ul className="flex flex-col">
          {staff.map((person) => (
            <li key={person.id}>
              <CheckboxField
                label={
                  person.role === "manager" ? `${person.name} · Manager` : person.name
                }
                description={describeCoverage(person, levels)}
                isChecked={selected.includes(person.id)}
                onChange={(isChecked) =>
                  onChange(
                    isChecked
                      ? [...selected, person.id]
                      : selected.filter((id) => id !== person.id),
                  )
                }
              />
            </li>
          ))}
        </ul>
      );
  } else if (assignable.isError) {
    list = (
      <InlineError
        message="Couldn’t load Tutors. Check your connection."
        onRetry={() => void assignable.refetch()}
        isRetrying={assignable.isFetching}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {list}
      {error && <PickerError message={error} />}
      {uncovered.length > 0 && <UncoveredNote levels={uncovered} />}
      <p className="px-1 text-[13px] text-(--tl-muted)">
        Admins can’t be Assigned Tutors. The bot only offers Tutors picked here.
      </p>
    </div>
  );
}

type PickerErrorProps = { message: string };

function PickerError({ message }: PickerErrorProps): ReactNode {
  return (
    <p role="alert" className="px-1 text-[13px] font-medium text-(--tl-danger)">
      {message}
    </p>
  );
}

type UncoveredNoteProps = { levels: CoverageLevel[] };

function UncoveredNote({ levels }: UncoveredNoteProps): ReactNode {
  const names = joinNames(levels.map((level) => `${level.name} ${gradeName(level.level)}`));
  return (
    <p className="kit-rise flex items-start gap-2 rounded-[16px] bg-(--tl-surface-sunk) px-4 py-3 text-[13px] leading-5 text-(--tl-ink-soft)">
      <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>
        None of them covers {names}. When a Guardian asks for{" "}
        {levels.length === 1 ? "it" : "them"}, the bot hands the request to the
        office.
      </span>
    </p>
  );
}

function PickerSkeleton(): ReactNode {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col">
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <div key={index} className="flex items-start gap-3 py-2.5">
          <Skeleton className="mt-0.5 size-5 shrink-0 rounded-[6px]" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-1/3 rounded-full" />
            <Skeleton className="h-3 w-1/2 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
