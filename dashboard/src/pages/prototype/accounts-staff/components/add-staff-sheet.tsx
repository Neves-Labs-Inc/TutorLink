// Add staff (Admins only): the short form from #190. Saving opens their
// Staff details with the setup checklist. POST /api/users, then
// POST /api/users/{id}/invite when "Send invite now" is on.
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Button } from "@/components/kit/components/button";
import { RadioCards, SwitchField } from "@/components/kit/components/choices";
import { TextField } from "@/components/kit/components/fields";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import { useToast } from "@/components/kit/overlays/use-toast";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import type { UserRole } from "@/pages/prototype/accounts-staff/types/api";

const FORM_ID = "add-staff-form";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;
const PHONE_PATTERN = /^\+?[\d\s()-]{10,}$/;

const ROLE_OPTIONS = [
  { value: "tutor", label: "Tutor", description: "Teaches Sessions. Sees only their own." },
  { value: "manager", label: "Manager", description: "Teaches, and runs Bookings and Chats with the office." },
  { value: "admin", label: "Admin", description: "Full access, Settings included. Doesn’t teach through the bot." },
];

type Errors = Partial<Record<"name" | "email" | "phone", string>>;

type AddStaffSheetProps = {
  onClose: () => void;
  onCreated: (id: string) => void;
};

export default function AddStaffSheet({ onClose, onCreated }: AddStaffSheetProps): ReactNode {
  const { db, addStaff } = useArea();
  const { showToast } = useToast();
  const [role, setRole] = useState<UserRole>("tutor");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [shouldInvite, setShouldInvite] = useState(true);
  const [hasTried, setHasTried] = useState(false);
  const isTeacher = role !== "admin";
  const isEmailTaken = db.staff.some((row) => row.email.toLowerCase() === email.trim().toLowerCase());

  function validate(): Errors {
    return {
      ...(name.trim() ? {} : { name: "Enter their name." }),
      ...(!EMAIL_PATTERN.test(email.trim())
        ? { email: "Enter an email address. Their Invite goes here." }
        : isEmailTaken
          ? { email: "Someone on Staff already uses this email." }
          : {}),
      ...(isTeacher && !PHONE_PATTERN.test(phone.trim()) ? { phone: "Enter a phone number." } : {}),
    };
  }

  const errors = hasTried ? validate() : {};

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setHasTried(true);
    if (Object.keys(validate()).length > 0) return;
    const id = addStaff({
      role,
      name: name.trim(),
      email: email.trim(),
      phone_number: isTeacher ? phone.replace(/[^\d+]/g, "") : "",
      shouldInvite,
    });
    showToast({
      tone: "success",
      message: shouldInvite ? `${name.trim()} added. Invite sent to ${email.trim()}.` : `${name.trim()} added.`,
    });
    onCreated(id);
  }

  return (
    <BottomSheet
      isOpen
      onClose={onClose}
      title="Add staff"
      description="You’ll set up their Subjects and Availability next."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={FORM_ID}>
            Add staff
          </Button>
        </>
      }
    >
      <form id={FORM_ID} noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
        <RadioCards
          legend="Role"
          options={ROLE_OPTIONS}
          value={role}
          // Values come from ROLE_OPTIONS.
          onChange={(value) => setRole(value as UserRole)}
        />
        <TextField label="Name" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
        <TextField label="Email" required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        {isTeacher && (
          <TextField
            label="Phone"
            required
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            error={errors.phone}
          />
        )}
        <SwitchField
          label="Send invite now"
          description="An email to choose their password. You can send it later from their details."
          isOn={shouldInvite}
          onChange={setShouldInvite}
        />
      </form>
    </BottomSheet>
  );
}
