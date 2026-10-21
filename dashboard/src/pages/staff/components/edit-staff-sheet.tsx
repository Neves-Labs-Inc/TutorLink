// Edit a Staff member (header Edit, Admins). Role moves only between
// Tutor and Manager; an Admin's is fixed. Mount a fresh instance per
// open (key) so it starts from the row as saved.
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import { RadioCards } from "@/components/kit/components/choices";
import { TextAreaField, TextField } from "@/components/kit/components/fields";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import { FormAlert } from "@/components/kit/states/states";
import type { StaffRead, StaffRole } from "@/lib/queries/staff";
import { useEditStaff } from "@/pages/staff/hooks/use-edit-staff";

const FORM_ID = "edit-staff-form";

const ROLE_OPTIONS = [
  { value: "tutor", label: "Tutor" },
  {
    value: "manager",
    label: "Manager",
    description: "Keeps their Subjects and Availability",
  },
];

type EditStaffSheetProps = {
  isOpen: boolean;
  staff: StaffRead;
  canChangeRole: boolean;
  onClose: () => void;
};

export default function EditStaffSheet({
  isOpen,
  staff,
  canChangeRole,
  onClose,
}: EditStaffSheetProps): ReactNode {
  // Destructured: the compiler lint reads any property of an object that
  // holds refs as a ref read during render.
  const {
    values,
    errors,
    formError,
    isSaving,
    hasProfile,
    formRef,
    changeValue,
    handleBlur,
    handleSubmit,
    handleClose,
  } = useEditStaff(staff, onClose);

  // The alert sits under the fields, often below the fold; bring it up.
  const failureRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (formError) failureRef.current?.scrollIntoView({ block: "nearest" });
  }, [formError]);

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={handleClose}
      title={`Edit ${staff.name}`}
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
            Save
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
          {canChangeRole && (
            <RadioCards
              legend="Role"
              options={ROLE_OPTIONS}
              value={values.role}
              // The only values are ROLE_OPTIONS'.
              onChange={(role) => changeValue("role", role as StaffRole)}
            />
          )}
          {staff.role === "admin" && (
            <p className="flex items-start gap-2 rounded-[16px] bg-(--tl-surface-sunk) px-4 py-3 text-[13px] leading-5 text-(--tl-ink-soft)">
              <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
              An Admin’s role can’t change. To move someone in or out of Admin,
              archive them and add them again.
            </p>
          )}
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
            help="They sign in with it, and Invites go here."
            value={values.email}
            error={errors.email}
            onChange={(event) => changeValue("email", event.target.value)}
          />
          {hasProfile && (
            <>
              <TextField
                label="Phone"
                required
                type="tel"
                autoComplete="tel"
                value={values.phone}
                error={errors.phone}
                onChange={(event) => changeValue("phone", event.target.value)}
              />
              <TextAreaField
                label="Bio"
                rows={3}
                value={values.bio}
                onChange={(event) => changeValue("bio", event.target.value)}
              />
            </>
          )}
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
