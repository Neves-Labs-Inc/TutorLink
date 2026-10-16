// The Guardian's two forms: Edit (ClientUpdate, plus the Guardian
// language through PATCH /api/conversations/{id}) and Add child
// (ChildCreate linked to this Guardian).
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import {
  SelectField,
  TextAreaField,
  TextField,
} from "@/pages/prototype/shell-kit/kit/components/fields";
import { BottomSheet } from "@/pages/prototype/shell-kit/kit/overlays/bottom-sheet";
import type { NewChild } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import { GRADE_OPTIONS } from "@/pages/prototype/accounts-staff/lib/labels";
import type {
  ClientRead,
  Language,
  NamedRef,
} from "@/pages/prototype/accounts-staff/types/api";

export type GuardianEdit = { name: string; phone_number: string; language: Language | null };

type EditGuardianSheetProps = {
  guardian: ClientRead;
  onClose: () => void;
  onSave: (edit: GuardianEdit) => void;
};

export function EditGuardianSheet({ guardian, onClose, onSave }: EditGuardianSheetProps): ReactNode {
  const [name, setName] = useState(guardian.name);
  const [phone, setPhone] = useState(guardian.phone_number);
  const [language, setLanguage] = useState<string>(guardian.language ?? "en");
  const hasConversation = guardian.language_conversation_id !== null;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!name.trim() || !phone.trim()) return;
    onSave({
      name: name.trim(),
      phone_number: phone.trim(),
      // Values come from the two options below.
      language: hasConversation ? (language as Language) : guardian.language,
    });
  }

  return (
    <BottomSheet
      isOpen
      onClose={onClose}
      title="Edit Guardian"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="guardian-form">Save</Button>
        </>
      }
    >
      <form id="guardian-form" noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
        <TextField label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="WhatsApp number" required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <SelectField
          label="Guardian language"
          help={
            hasConversation
              ? "Every message to them uses it, Booking reminders included."
              : "Detected when they first message the bot. Until then, English."
          }
          disabled={!hasConversation}
          options={[
            { value: "en", label: "English" },
            { value: "es", label: "Spanish" },
          ]}
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
        />
      </form>
    </BottomSheet>
  );
}

type AddChildSheetProps = {
  // The Guardians the new Child links to (ChildCreate.guardian_ids).
  guardians: NamedRef[];
  onClose: () => void;
  onSave: (child: NewChild) => void;
};

export function AddChildSheet({ guardians, onClose, onSave }: AddChildSheetProps): ReactNode {
  const names = guardians.map((guardian) => guardian.name).join(" and ");
  const [name, setName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [grade, setGrade] = useState("");
  const [school, setSchool] = useState("");
  const [notes, setNotes] = useState("");
  const [hasTried, setHasTried] = useState(false);
  const nameError = hasTried && !name.trim() ? "Enter the Child’s name." : undefined;
  const dateError = hasTried && !dateOfBirth ? "Enter their date of birth." : undefined;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setHasTried(true);
    if (!name.trim() || !dateOfBirth) return;
    onSave({
      guardian_ids: guardians.map((guardian) => guardian.id),
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
      title="Add child"
      description={
        guardians.length > 0
          ? `Linked to ${names}. They can be booked at their Homes.`
          : "Starts a new family. Add a Guardian next: the bot talks only to Guardians, and Homes come from them."
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="add-child-form">Add child</Button>
        </>
      }
    >
      <form id="add-child-form" noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
        <TextField label="Name" required value={name} onChange={(e) => setName(e.target.value)} error={nameError} />
        <div className="grid gap-5 @md:grid-cols-2">
          <TextField label="Date of birth" required type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} error={dateError} />
          <SelectField
            label="Overall grade"
            options={[{ value: "", label: "Not set" }, ...GRADE_OPTIONS]}
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
          />
        </div>
        <TextField label="School" value={school} onChange={(e) => setSchool(e.target.value)} />
        <TextAreaField label="Child notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </form>
    </BottomSheet>
  );
}
