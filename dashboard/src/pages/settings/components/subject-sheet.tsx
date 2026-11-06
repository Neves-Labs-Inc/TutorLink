// Add or Edit a Subject (BottomSheet). Mount it once and drive it with
// isOpen so the exit plays; key it per open so the form starts fresh.
// Ticket 03's Archive / Restore button goes first in the Edit footer.
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/kit/components/button";
import { TextAreaField, TextField } from "@/components/kit/components/fields";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import { FormAlert } from "@/components/kit/states/states";
import type { Subject } from "@/lib/queries/subjects";
import { useSubjectForm } from "@/pages/settings/hooks/use-subject-form";

const FORM_ID = "subject-form";

type SubjectSheetProps = {
  isOpen: boolean;
  // null adds a new Subject.
  subject: Subject | null;
  onClose: () => void;
  onAdded: () => void;
};

export default function SubjectSheet({
  isOpen,
  subject,
  onClose,
  onAdded,
}: SubjectSheetProps): ReactNode {
  // Destructured: the compiler lint reads any property of an object that
  // holds refs as a ref read during render.
  const {
    values,
    errors,
    formError,
    isSaving,
    formRef,
    changeValue,
    handleBlur,
    handleSubmit,
    handleClose,
  } = useSubjectForm(subject, onClose, onAdded);
  const isEdit = subject !== null;
  const commitLabel = isEdit ? "Save" : "Add subject";

  // The alert sits under the fields, often below the fold; bring it up.
  const failureRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (formError) failureRef.current?.scrollIntoView({ block: "nearest" });
  }, [formError]);

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={handleClose}
      title={isEdit ? "Edit subject" : "Add subject"}
      description={
        isEdit
          ? "Changes show for every Tutor who teaches it."
          : "Once added, it can be assigned to Tutors."
      }
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={FORM_ID}
            isLoading={isSaving}
          >
            {commitLabel}
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
          <TextField
            label="Name"
            required
            autoComplete="off"
            value={values.name}
            error={errors.name}
            onChange={(event) => changeValue("name", event.target.value)}
          />
          <TextField
            label="Spanish name"
            help="Used in messages to Spanish-speaking Guardians. Leave blank to use the English name."
            value={values.nameEs}
            error={errors.nameEs}
            onChange={(event) => changeValue("nameEs", event.target.value)}
          />
          <TextAreaField
            label="Description"
            rows={3}
            value={values.description}
            onChange={(event) => changeValue("description", event.target.value)}
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
