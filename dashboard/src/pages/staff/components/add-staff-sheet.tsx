// Add staff (Admins, the Staff page's primary action): Role, contact
// and whether to send the Invite now. Saving opens their details with
// the setup checklist.
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/kit/components/button";
import { RadioCards, SwitchField } from "@/components/kit/components/choices";
import { TextField } from "@/components/kit/components/fields";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import { FormAlert } from "@/components/kit/states/states";
import type { StaffRole } from "@/lib/queries/staff";
import { useAddStaff } from "@/pages/staff/hooks/use-add-staff";

const FORM_ID = "add-staff-form";

const ROLE_OPTIONS = [
  {
    value: "tutor",
    label: "Tutor",
    description: "Teaches Sessions. Sees only their own.",
  },
  {
    value: "manager",
    label: "Manager",
    description: "Teaches, and runs Bookings and Chats with the office.",
  },
  {
    value: "admin",
    label: "Admin",
    description:
      "Full access, Settings included. Doesn’t teach through the bot.",
  },
];

type AddStaffSheetProps = {
  isOpen: boolean;
  onClose: () => void;
};

export default function AddStaffSheet({
  isOpen,
  onClose,
}: AddStaffSheetProps): ReactNode {
  // Destructured: the compiler lint reads any property of an object that
  // holds refs as a ref read during render.
  const {
    values,
    errors,
    formError,
    isSaving,
    hasPhone,
    formRef,
    changeValue,
    handleBlur,
    handleSubmit,
    handleClose,
  } = useAddStaff(onClose);

  // The alert sits under the fields, often below the fold; bring it up.
  const failureRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (formError) failureRef.current?.scrollIntoView({ block: "nearest" });
  }, [formError]);

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={handleClose}
      title="Add staff"
      description="You’ll set up their Subjects and Availability next."
      footer={
        <>
          <Button onClick={handleClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={FORM_ID}
            isLoading={isSaving}
          >
            Add staff
          </Button>
        </>
      }
    >
      <form
        ref={formRef}
        id={FORM_ID}
        data-autofocus
        noValidate
        onSubmit={handleSubmit}
        onBlur={handleBlur}
      >
        <fieldset disabled={isSaving} className="flex min-w-0 flex-col gap-4">
          <RadioCards
            legend="Role"
            options={ROLE_OPTIONS}
            value={values.role}
            // The only values are ROLE_OPTIONS'.
            onChange={(role) => changeValue("role", role as StaffRole)}
          />
          <TextField
            label="Name"
            required
            autoComplete="name"
            value={values.name}
            error={errors.name}
            onChange={(event) => changeValue("name", event.target.value)}
          />
          <TextField
            label="Email"
            required
            type="email"
            autoComplete="email"
            value={values.email}
            error={errors.email}
            onChange={(event) => changeValue("email", event.target.value)}
          />
          {hasPhone && (
            <TextField
              label="Phone"
              required
              type="tel"
              autoComplete="tel"
              value={values.phone}
              error={errors.phone}
              onChange={(event) => changeValue("phone", event.target.value)}
            />
          )}
          <SwitchField
            label="Send invite now"
            description="An email to choose their password. You can send it later from their details."
            isOn={values.shouldInvite}
            onChange={(isOn) => changeValue("shouldInvite", isOn)}
            isDisabled={isSaving}
          />
          {formError && (
            <div ref={failureRef}>
              <FormAlert tone="danger" title={formError} />
            </div>
          )}
        </fieldset>
      </form>
    </BottomSheet>
  );
}
