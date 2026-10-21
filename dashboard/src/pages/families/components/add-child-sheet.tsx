// Add child on a family page: joins the ticked live Guardians. Keep it
// mounted and drive it with isOpen.
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import { CheckboxField } from "@/components/kit/components/choices";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import ChildFields from "@/pages/families/components/child-fields";
import CheckGroup from "@/pages/families/components/check-group";
import SheetFailureLine from "@/pages/families/components/sheet-failure-line";
import { useAddChildForm } from "@/pages/families/hooks/use-add-child-form";
import { useFirstFieldFocus } from "@/pages/families/hooks/use-first-field-focus";
import type { ChildRead, NamedRef } from "@/types/families";

const FORM_ID = "add-child-form";

type AddChildSheetProps = {
  isOpen: boolean;
  liveGuardians: NamedRef[];
  onClose: () => void;
  onAdded: (child: ChildRead) => void;
};

export default function AddChildSheet({
  isOpen,
  liveGuardians,
  onClose,
  onAdded,
}: AddChildSheetProps): ReactNode {
  const form = useAddChildForm({
    isOpen,
    guardianIds: liveGuardians.map((guardian) => guardian.id),
    onAdded,
  });
  const attachForm = useFirstFieldFocus(isOpen);
  const { draft, errors, isSaving } = form;
  // The failure line can land under the footer; bring it up.
  const failureRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (form.failure) failureRef.current?.scrollIntoView({ block: "nearest" });
  }, [form.failure]);

  function handleClose(): void {
    if (isSaving) return;
    onClose();
  }

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={handleClose}
      title="Add child"
      footer={
        <>
          <Button onClick={handleClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={FORM_ID}
            icon={Plus}
            isLoading={isSaving}
          >
            Add child
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        ref={attachForm}
        noValidate
        onSubmit={form.submit}
        className="flex flex-col gap-5"
      >
        <ChildFields
          value={draft}
          errors={errors}
          onChange={form.change}
          onBlur={form.validate}
        />
        {liveGuardians.length > 1 && (
          <CheckGroup legend="Belongs to" error={errors.guardians}>
            {liveGuardians.map((guardian) => (
              <CheckboxField
                key={guardian.id}
                label={guardian.name}
                isChecked={draft.guardianIds.includes(guardian.id)}
                onChange={(isChecked) =>
                  form.toggleGuardian(guardian.id, isChecked)
                }
              />
            ))}
          </CheckGroup>
        )}
        {form.failure && (
          <div ref={failureRef}>
            <SheetFailureLine message={form.failure} />
          </div>
        )}
      </form>
    </BottomSheet>
  );
}
