// Add child from the Families list: the Child's fields plus the Guardian
// it needs, new or existing (#233). Keep it mounted and drive it with
// isOpen. The sheet shows the success toast; the caller navigates.
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Baby } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import { CheckboxField } from "@/components/kit/components/choices";
import { Combobox } from "@/components/kit/components/combobox";
import { TextField } from "@/components/kit/components/fields";
import { SegmentedControl } from "@/components/kit/components/tabs";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import { InlineError, Skeleton } from "@/components/kit/states/states";
import { EYEBROW } from "@/components/kit/tokens";
import ChildFields from "@/pages/families/components/child-fields";
import CheckGroup from "@/pages/families/components/check-group";
import SheetFailureLine from "@/pages/families/components/sheet-failure-line";
import { useAddChildFromListForm } from "@/pages/families/hooks/use-add-child-from-list-form";
import type { GuardianChoice } from "@/pages/families/hooks/use-add-child-from-list-form";
import { useFirstFieldFocus } from "@/pages/families/hooks/use-first-field-focus";
import { formatPhone } from "@/pages/families/lib/family-labels";
import type { ChildRead } from "@/types/families";

const FORM_ID = "add-child-from-list-form";
const CHOICES = [
  { id: "new", label: "New guardian" },
  { id: "existing", label: "Existing guardian" },
];

type AddChildFromListSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  onAdded: (child: ChildRead) => void;
};

export default function AddChildFromListSheet({
  isOpen,
  onClose,
  onAdded,
}: AddChildFromListSheetProps): ReactNode {
  const form = useAddChildFromListForm({ isOpen, onAdded });
  const attachForm = useFirstFieldFocus(isOpen);
  const { draft, errors, isSaving, guardians, family } = form;
  // A failure can land under the footer; bring it up and read it first.
  const failureRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!form.failure) return;
    failureRef.current?.scrollIntoView({ block: "nearest" });
    failureRef.current?.focus();
  }, [form.failure]);

  function handleClose(): void {
    if (isSaving) return;
    onClose();
  }

  const pickedName = guardians.options.find(
    (guardian) => guardian.id === draft.pickedId,
  )?.name;
  const firstName = (pickedName ?? "").split(" ")[0];

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
            icon={Baby}
            isLoading={isSaving}
            // Sending before the family loads would drop its other Guardians.
            disabled={family.isLoading}
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
          onChange={form.changeChild}
          onBlur={form.validate}
        />
        <div className="mt-1 flex flex-col gap-3">
          <h3 className={EYEBROW}>Guardian</h3>
          <SegmentedControl
            label="Guardian"
            items={CHOICES}
            activeId={draft.choice}
            onChange={(id) => form.setChoice(id as GuardianChoice)}
            isFullWidth
          />
        </div>
        {draft.choice === "new" ? (
          <>
            <TextField
              label="Name"
              required
              autoComplete="name"
              value={draft.guardianName}
              onChange={(event) => form.setGuardianName(event.target.value)}
              onBlur={form.validate}
              error={errors.guardianName ?? undefined}
            />
            <TextField
              label="WhatsApp number"
              required
              type="tel"
              inputMode="tel"
              placeholder="+1 305 555 0100"
              help="The bot talks to them on this number."
              value={draft.guardianPhone}
              onChange={(event) => form.setGuardianPhone(event.target.value)}
              onBlur={form.validate}
              error={errors.guardianPhone ?? undefined}
            />
          </>
        ) : (
          <>
            {guardians.isLoading && (
              <div role="status" aria-label="Loading Guardians" className="flex flex-col gap-2">
                <span className="text-[14px] font-semibold">Guardian</span>
                <Skeleton className="h-11 rounded-full" />
              </div>
            )}
            {guardians.isError && (
              <InlineError
                message="Couldn’t load Guardians. Check your connection."
                onRetry={guardians.retry}
              />
            )}
            {!guardians.isLoading && !guardians.isError && (
              <Combobox
                label="Guardian"
                isRequired
                placeholder="Search by name or phone"
                emptyText="No active Guardians."
                options={guardians.options.map((guardian) => ({
                  value: guardian.id,
                  label: guardian.name,
                  description: formatPhone(guardian.phone_number),
                  hasAvatar: true,
                }))}
                value={draft.pickedId}
                onChange={form.pickGuardian}
                error={errors.pick ?? undefined}
              />
            )}
            {family.isLoading && (
              <div role="status" aria-label="Loading their family" className="flex flex-col gap-3">
                {[0, 1].map((row) => (
                  <div key={row} className="flex items-center gap-3">
                    <Skeleton className="size-5 rounded-[6px]" />
                    <Skeleton className="h-4 w-1/3" />
                  </div>
                ))}
              </div>
            )}
            {family.isError && (
              <InlineError
                message={`Couldn’t load ${firstName}’s family. Check your connection.`}
                onRetry={family.retry}
              />
            )}
            {family.others.length > 0 && (
              <CheckGroup legend="Also belongs to">
                {family.others.map((guardian) => (
                  <CheckboxField
                    key={guardian.id}
                    label={guardian.name}
                    isChecked={!draft.untickedIds.includes(guardian.id)}
                    onChange={(isChecked) =>
                      form.toggleOther(guardian.id, isChecked)
                    }
                  />
                ))}
              </CheckGroup>
            )}
          </>
        )}
        {form.failure && (
          <div ref={failureRef} tabIndex={-1} className="outline-none">
            <SheetFailureLine message={form.failure} />
          </div>
        )}
      </form>
    </BottomSheet>
  );
}
