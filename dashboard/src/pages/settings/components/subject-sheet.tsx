// Add or Edit a Subject (BottomSheet). Mount it once and drive it with
// isOpen so the exit plays; key it per open so the form starts fresh.
// An Edit footer starts with Archive (or Restore for an archived one).
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Archive, ArchiveRestore } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import { TextAreaField, TextField } from "@/components/kit/components/fields";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import { FormAlert } from "@/components/kit/states/states";
import ArchiveSubjectDialog from "@/pages/settings/components/archive-subject-dialog";
import type { Subject } from "@/lib/queries/subjects";
import { useSubjectArchive } from "@/pages/settings/hooks/use-subject-archive";
import { useSubjectForm } from "@/pages/settings/hooks/use-subject-form";

const FORM_ID = "subject-form";

type SubjectSheetProps = {
  isOpen: boolean;
  // null adds a new Subject.
  subject: Subject | null;
  onClose: () => void;
  onAdded: () => void;
  // After an Archive or Restore, once the list has refetched.
  onActed: () => void;
};

export default function SubjectSheet({
  isOpen,
  subject,
  onClose,
  onAdded,
  onActed,
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
    clearFormError,
  } = useSubjectForm(subject, onClose, onAdded);
  const archive = useSubjectArchive(subject, onClose, onActed, clearFormError);
  const isEdit = subject !== null;
  const commitLabel = isEdit ? "Save" : "Add subject";
  const isBusy = isSaving || archive.isRestoring;
  // Only the latest of the two alerts shows: each act clears the other's.
  const alertTitle = archive.restoreFailure ?? formError;

  // The alert sits under the fields, often below the fold; bring it up.
  const failureRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (alertTitle) failureRef.current?.scrollIntoView({ block: "nearest" });
  }, [alertTitle]);

  return (
    <>
      <BottomSheet
        isOpen={isOpen}
        // Closing mid-restore would hide whether it worked.
        onClose={archive.isRestoring ? () => {} : handleClose}
        title={isEdit ? "Edit subject" : "Add subject"}
        description={
          isEdit
            ? "Changes show for every Tutor who teaches it."
            : "Once added, it can be assigned to Tutors."
        }
        footer={
          <>
            {isEdit && !subject.archived && (
              <Button
                variant="danger-outline"
                icon={Archive}
                className="@md:mr-auto"
                onClick={archive.askToArchive}
                disabled={isSaving}
              >
                Archive
              </Button>
            )}
            {isEdit && subject.archived && (
              <Button
                variant="outline"
                icon={ArchiveRestore}
                className="@md:mr-auto"
                onClick={archive.restore}
                isLoading={archive.isRestoring}
                disabled={isSaving}
              >
                Restore
              </Button>
            )}
            <Button variant="outline" onClick={handleClose} disabled={isBusy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form={FORM_ID}
              isLoading={isSaving}
              disabled={archive.isRestoring}
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
          onSubmit={(event) => {
            archive.clearRestoreFailure();
            handleSubmit(event);
          }}
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
              onChange={(event) =>
                changeValue("description", event.target.value)
              }
            />
            {alertTitle && (
              <div ref={failureRef}>
                <FormAlert tone="danger" title={alertTitle}>
                  {archive.restoreFailure &&
                    "Check your connection and try again."}
                </FormAlert>
              </div>
            )}
          </fieldset>
        </form>
      </BottomSheet>
      {/* Outside the sheet: its body is held frozen while the sheet exits. */}
      {isEdit && <ArchiveSubjectDialog subject={subject} archive={archive} />}
    </>
  );
}
