// The Child's two forms: Edit details (ChildUpdate) and Set a Subject
// level (PUT /api/children/{id}/levels/{subject_id}).
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import {
  SelectField,
  TextAreaField,
  TextField,
} from "@/pages/prototype/shell-kit/kit/components/fields";
import { BottomSheet } from "@/pages/prototype/shell-kit/kit/overlays/bottom-sheet";
import {
  formatGrade,
  GRADE_OPTIONS,
} from "@/pages/prototype/accounts-staff/lib/labels";
import { SUBJECTS } from "@/pages/prototype/accounts-staff/lib/mock-data";
import type { ChildDetail } from "@/pages/prototype/accounts-staff/types/api";

const NOTES_MAX = 2000;

export type ChildEdit = {
  name: string;
  date_of_birth: string;
  grade_level: number | null;
  school_name: string;
  notes: string | null;
};

type EditChildSheetProps = {
  child: ChildDetail;
  onClose: () => void;
  onSave: (edit: ChildEdit) => void;
};

export function EditChildSheet({ child, onClose, onSave }: EditChildSheetProps): ReactNode {
  const [name, setName] = useState(child.name);
  const [dateOfBirth, setDateOfBirth] = useState(child.date_of_birth ?? "");
  const [grade, setGrade] = useState(child.grade_level === null ? "" : String(child.grade_level));
  const [school, setSchool] = useState(child.school_name);
  const [notes, setNotes] = useState(child.notes ?? "");
  const nameError = name.trim() ? undefined : "Enter the Child’s name.";

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (nameError) return;
    onSave({
      name: name.trim(),
      date_of_birth: dateOfBirth,
      grade_level: grade === "" ? null : Number(grade),
      school_name: school.trim(),
      notes: notes.trim() || null,
    });
  }

  return (
    <BottomSheet
      isOpen
      onClose={onClose}
      title="Edit details"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="child-form">
            Save
          </Button>
        </>
      }
    >
      <form id="child-form" noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
        <TextField label="Name" required value={name} onChange={(e) => setName(e.target.value)} error={nameError} />
        <div className="grid gap-5 @md:grid-cols-2">
          <TextField label="Date of birth" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
          <SelectField
            label="Overall grade"
            help="The Guardian’s estimate. Not used to match Tutors."
            options={[{ value: "", label: "Not set" }, ...GRADE_OPTIONS]}
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
          />
        </div>
        <TextField label="School" value={school} onChange={(e) => setSchool(e.target.value)} />
        <TextAreaField
          label="Child notes"
          help="Tutors see these with each Session: needs, allergies, how to approach sessions."
          rows={3}
          maxLength={NOTES_MAX}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </form>
    </BottomSheet>
  );
}

type LevelSheetProps = {
  child: ChildDetail;
  onClose: () => void;
  onSave: (subjectId: string, level: number) => void;
};

export function LevelSheet({ child, onClose, onSave }: LevelSheetProps): ReactNode {
  const [subjectId, setSubjectId] = useState(SUBJECTS[0].id);
  const current = child.levels.find((item) => item.subject_id === subjectId);
  const [level, setLevel] = useState(String(current?.level ?? child.grade_level ?? 0));

  function handleSubjectChange(next: string): void {
    setSubjectId(next);
    const existing = child.levels.find((item) => item.subject_id === next);
    setLevel(String(existing?.level ?? child.grade_level ?? 0));
  }

  return (
    <BottomSheet
      isOpen
      onClose={onClose}
      title="Set Subject level"
      description={`The grade ${child.name} works at in one subject. Tutors are matched against it.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onSave(subjectId, Number(level))}>
            {current ? "Change level" : "Set level"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <SelectField
          label="Subject"
          options={SUBJECTS.map((subject) => ({ value: subject.id, label: subject.name }))}
          value={subjectId}
          onChange={(e) => handleSubjectChange(e.target.value)}
        />
        <SelectField
          label="Subject level"
          help={current ? `Now ${formatGrade(current.level)}, set by ${current.set_by.name}.` : undefined}
          options={GRADE_OPTIONS}
          value={level}
          onChange={(e) => setLevel(e.target.value)}
        />
      </div>
    </BottomSheet>
  );
}
