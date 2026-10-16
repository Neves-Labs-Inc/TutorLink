// Edit a Staff member: name, email, phone and bio (UserUpdate plus
// TutorUpdate). Role changes are Tutor ↔ Manager only; an Admin's role
// is fixed (archive and add a new one instead).
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Button } from "@/components/kit/components/button";
import { RadioCards } from "@/components/kit/components/choices";
import { TextAreaField, TextField } from "@/components/kit/components/fields";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import { useToast } from "@/components/kit/overlays/use-toast";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import { readTutor } from "@/pages/prototype/accounts-staff/lib/mock-api";
import type { StaffRead, UserRole } from "@/pages/prototype/accounts-staff/types/api";

type EditStaffSheetProps = {
  staff: StaffRead;
  canChangeRole: boolean;
  onClose: () => void;
};

export default function EditStaffSheet({
  staff,
  canChangeRole,
  onClose,
}: EditStaffSheetProps): ReactNode {
  const { db, updateStaff } = useArea();
  const { showToast } = useToast();
  const tutor = readTutor(db, staff.id);
  const [role, setRole] = useState<UserRole>(staff.role);
  const [name, setName] = useState(staff.name);
  const [email, setEmail] = useState(staff.email);
  const [phone, setPhone] = useState(tutor?.phone_number ?? "");
  const [bio, setBio] = useState(tutor?.bio ?? "");

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!name.trim() || !email.trim()) return;
    updateStaff(staff.id, {
      role,
      name: name.trim(),
      email: email.trim(),
      ...(tutor ? { phone_number: phone.trim(), bio: bio.trim() || null } : {}),
    });
    showToast({ tone: "success", message: "Saved." });
    onClose();
  }

  return (
    <BottomSheet
      isOpen
      onClose={onClose}
      title={`Edit ${staff.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="edit-staff-form">Save</Button>
        </>
      }
    >
      <form id="edit-staff-form" noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
        {canChangeRole && (
          <RadioCards
            legend="Role"
            isHorizontal
            options={[
              { value: "tutor", label: "Tutor" },
              { value: "manager", label: "Manager", description: "Keeps their Subjects and Availability" },
            ]}
            value={role}
            // Values come from the two options above.
            onChange={(value) => setRole(value as UserRole)}
          />
        )}
        <TextField label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
        <TextField
          label="Email"
          required
          type="email"
          help="They sign in with it, and Invites go here."
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {tutor && (
          <>
            <TextField label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <TextAreaField label="Bio" rows={3} value={bio} onChange={(e) => setBio(e.target.value)} />
          </>
        )}
        {!canChangeRole && staff.role === "admin" && (
          <p className="text-[13px] text-(--tl-muted)">
            An Admin’s role can’t change. To move someone in or out of Admin, archive them and add them again.
          </p>
        )}
      </form>
    </BottomSheet>
  );
}
