// Pick a Child's Assigned Tutors: every live Tutor and Manager (never an
// Admin), each with what they cover of the Child's Subject levels.
// Below, a note for any Subject level none of the picks covers.
import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { CheckboxField } from "@/components/kit/components/choices";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import {
  describeCoverage,
  formatLevel,
  getUncovered,
  joinNames,
  listAssignable,
} from "@/pages/prototype/accounts-staff/lib/assigned-tutors";
import type { LevelLike } from "@/pages/prototype/accounts-staff/lib/assigned-tutors";

type AssignedTutorsPickerProps = {
  levels: LevelLike[];
  selected: string[];
  onChange: (ids: string[]) => void;
  error?: string;
};

export default function AssignedTutorsPicker({
  levels,
  selected,
  onChange,
  error,
}: AssignedTutorsPickerProps): ReactNode {
  const { db } = useArea();
  const assignable = listAssignable(db);
  const picked = assignable.filter((row) => selected.includes(row.id));
  const uncovered = picked.length > 0 ? getUncovered(levels, picked) : [];

  function toggle(id: string, isChecked: boolean): void {
    onChange(isChecked ? [...selected, id] : selected.filter((item) => item !== id));
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col">
        {assignable.map((row) => (
          <li key={row.id}>
            <CheckboxField
              label={row.role === "manager" ? `${row.name} · Manager` : row.name}
              description={describeCoverage(row, levels)}
              isChecked={selected.includes(row.id)}
              onChange={(isChecked) => toggle(row.id, isChecked)}
            />
          </li>
        ))}
      </ul>
      {error && <p className="px-1 text-[13px] font-medium text-(--tl-danger)">{error}</p>}
      {uncovered.length > 0 && (
        <p className="flex items-start gap-2 rounded-[16px] bg-(--tl-surface-sunk) px-4 py-3 text-[13px] leading-5 text-(--tl-ink-soft)">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            None of them covers {joinNames(uncovered.map(formatLevel))}. When a
            Guardian asks for {uncovered.length === 1 ? "it" : "those"}, the bot
            hands the request to the office.
          </span>
        </p>
      )}
      <p className="px-1 text-[13px] text-(--tl-muted)">
        Admins can’t be Assigned Tutors. The bot only offers Tutors picked here.
      </p>
    </div>
  );
}
