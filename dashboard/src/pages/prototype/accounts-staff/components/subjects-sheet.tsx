// Edit the Subjects a Tutor or Manager teaches, each with the highest
// grade they take (TutorSubjectCreate.max_grade_level, required).
import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/kit/components/button";
import { CheckboxField } from "@/components/kit/components/choices";
import { SelectField } from "@/components/kit/components/fields";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import { useToast } from "@/components/kit/overlays/use-toast";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import { GRADE_OPTIONS } from "@/pages/prototype/accounts-staff/lib/labels";
import { SUBJECTS } from "@/pages/prototype/accounts-staff/lib/mock-data";
import type { TutorSubjectRead } from "@/pages/prototype/accounts-staff/types/api";

const DEFAULT_CEILING = 5;

type SubjectsSheetProps = {
  staffId: string;
  subjects: TutorSubjectRead[];
  onClose: () => void;
};

export default function SubjectsSheet({ staffId, subjects, onClose }: SubjectsSheetProps): ReactNode {
  const { setSubjects } = useArea();
  const { showToast } = useToast();
  const [ceilings, setCeilings] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(
      SUBJECTS.map((subject) => [
        subject.id,
        subjects.find((item) => item.subject_id === subject.id)?.max_grade_level ?? null,
      ]),
    ),
  );

  function handleSave(): void {
    const next = SUBJECTS.flatMap((subject) => {
      const ceiling = ceilings[subject.id];
      return ceiling === null ? [] : [{ subject_id: subject.id, name: subject.name, max_grade_level: ceiling }];
    });
    setSubjects(staffId, next);
    showToast({ tone: "success", message: "Subjects saved." });
    onClose();
  }

  return (
    <BottomSheet
      isOpen
      onClose={onClose}
      title="Subjects"
      description="The bot only offers them for Children at or below each grade."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave}>Save subjects</Button>
        </>
      }
    >
      <ul className="flex flex-col gap-3">
        {SUBJECTS.map((subject) => {
          const ceiling = ceilings[subject.id];
          return (
            <li key={subject.id} className="flex flex-col gap-2 rounded-[18px] border border-(--tl-border) px-4 py-2 @md:flex-row @md:items-center @md:justify-between">
              <CheckboxField
                label={subject.name}
                isChecked={ceiling !== null}
                onChange={(isChecked) =>
                  setCeilings((current) => ({ ...current, [subject.id]: isChecked ? DEFAULT_CEILING : null }))
                }
              />
              {ceiling !== null && (
                <div className="pb-2 @md:w-48 @md:pb-0">
                  <SelectField
                    label={`${subject.name}: highest grade`}
                    isLabelHidden
                    options={GRADE_OPTIONS}
                    value={String(ceiling)}
                    onChange={(e) => setCeilings((current) => ({ ...current, [subject.id]: Number(e.target.value) }))}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </BottomSheet>
  );
}
