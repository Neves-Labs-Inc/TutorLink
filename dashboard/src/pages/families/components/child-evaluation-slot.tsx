// Child details' Subject levels, Evaluated and Assigned Tutors, between
// the Child notes and the Guardians, with their three sheets: Set
// level, Mark Evaluated and the Assigned Tutors edit.
import { useState } from "react";
import type { ReactNode } from "react";
import AssignedTutorsSection from "@/pages/families/components/assigned-tutors-section";
import AssignedTutorsSheet from "@/pages/families/components/assigned-tutors-sheet";
import MarkEvaluatedSheet from "@/pages/families/components/mark-evaluated-sheet";
import SetLevelSheet from "@/pages/families/components/set-level-sheet";
import SubjectLevelsCard from "@/pages/families/components/subject-levels-card";
import type { ChildDetail } from "@/types/families";

type Sheet = "level" | "evaluated" | "tutors" | null;

type ChildEvaluationSlotProps = { child: ChildDetail };

export default function ChildEvaluationSlot({
  child,
}: ChildEvaluationSlotProps): ReactNode {
  const [sheet, setSheet] = useState<Sheet>(null);
  // A fresh form per open, starting from the Child as saved.
  const [formKey, setFormKey] = useState(0);
  const closeSheet = () => setSheet(null);

  function openSheet(next: Exclude<Sheet, null>): void {
    setFormKey((key) => key + 1);
    setSheet(next);
  }

  return (
    <>
      <SubjectLevelsCard
        child={child}
        onSetLevel={() => openSheet("level")}
        onMarkEvaluated={() => openSheet("evaluated")}
      />
      <AssignedTutorsSection child={child} onEdit={() => openSheet("tutors")} />
      <SetLevelSheet
        key={`level-${formKey}`}
        child={child}
        isOpen={sheet === "level"}
        onClose={closeSheet}
      />
      <MarkEvaluatedSheet
        key={`evaluated-${formKey}`}
        child={child}
        isOpen={sheet === "evaluated"}
        onClose={closeSheet}
      />
      <AssignedTutorsSheet
        key={`tutors-${formKey}`}
        child={child}
        isOpen={sheet === "tutors"}
        onClose={closeSheet}
      />
    </>
  );
}
