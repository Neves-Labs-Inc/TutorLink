// Change which Children a Tutor or Manager is an Assigned Tutor of, from
// Staff details. Lists Evaluated Children (Mark Evaluated sets the first
// Assigned Tutors), each with its family and what this Tutor covers.
// Taking off a Child's last Assigned Tutor is allowed after a confirm.
import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/kit/components/button";
import { CheckboxField } from "@/components/kit/components/choices";
import { SearchInput } from "@/components/kit/components/fields";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import { ConfirmDialog } from "@/components/kit/overlays/dialog";
import { useToast } from "@/components/kit/overlays/use-toast";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import {
  describeCoverage,
  joinNames,
} from "@/pages/prototype/accounts-staff/lib/assigned-tutors";
import { getFamilyTitle } from "@/pages/prototype/accounts-staff/lib/labels";
import { listChildren } from "@/pages/prototype/accounts-staff/lib/mock-api";
import type { StaffRow } from "@/pages/prototype/accounts-staff/lib/mock-data";

type AssignedChildrenSheetProps = { staff: StaffRow; onClose: () => void };

export default function AssignedChildrenSheet({ staff, onClose }: AssignedChildrenSheetProps): ReactNode {
  const { db, setAssignedChildren } = useArea();
  const { showToast } = useToast();
  // Assigned Tutors can't change until a Child is Evaluated (the API
  // refuses), so only Evaluated Children are offered.
  const children = listChildren(db, false).filter((child) => child.evaluated !== null);
  const linked = children.filter((child) => child.assigned_tutors.some((tutor) => tutor.id === staff.id));
  const [selected, setSelected] = useState(() => linked.map((child) => child.id));
  const [query, setQuery] = useState("");
  const [isConfirming, setIsConfirming] = useState(false);
  const first = staff.name.split(" ")[0];

  const needle = query.trim().toLowerCase();
  const candidates = children.filter(
    (child) =>
      (needle === "" ||
        child.name.toLowerCase().includes(needle) ||
        child.guardians.some((guardian) => guardian.name.toLowerCase().includes(needle))),
  );
  // Children this change would leave with no live Assigned Tutor.
  const leftEmpty = linked.filter(
    (child) => !selected.includes(child.id) && child.assigned_tutors.length === 1,
  );

  function save(): void {
    setAssignedChildren(staff.id, selected);
    onClose();
    showToast({
      tone: "success",
      message:
        leftEmpty.length > 0
          ? `Saved. ${joinNames(leftEmpty.map((child) => child.name))} now ${leftEmpty.length === 1 ? "needs a Tutor and is" : "need a Tutor and are"} in To do.`
          : `${first}’s Children saved.`,
    });
  }

  function toggle(id: string, isChecked: boolean): void {
    setSelected((current) => (isChecked ? [...current, id] : current.filter((item) => item !== id)));
  }

  return (
    <>
      <BottomSheet
        isOpen
        onClose={onClose}
        title={`${first}’s Children`}
        description={`The Children ${first} is an Assigned Tutor of. The bot may book them with ${first}.`}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => (leftEmpty.length > 0 ? setIsConfirming(true) : save())}>
              Save
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <SearchInput label="Search Children" placeholder="Child or Guardian" value={query} onChange={setQuery} />
          <p className="px-1 text-[13px] text-(--tl-muted)">
            Only Evaluated Children are listed: Mark Evaluated sets a Child’s first Assigned Tutors.
          </p>
          {candidates.length === 0 ? (
            <p className="rounded-[16px] bg-(--tl-surface-sunk) px-4 py-3 text-[14px] text-(--tl-muted)">
              No Children match.
            </p>
          ) : (
            <ul className="flex flex-col">
              {candidates.map((child) => {
                const others = child.assigned_tutors.filter((tutor) => tutor.id !== staff.id);
                const isLast = selected.includes(child.id) && others.length === 0;
                return (
                  <li key={child.id}>
                    <CheckboxField
                      label={child.name}
                      description={[
                        getFamilyTitle(child.guardians, [child]),
                        describeCoverage(staff, child.levels),
                        isLast ? `${first} is their only Assigned Tutor` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      isChecked={selected.includes(child.id)}
                      onChange={(isChecked) => toggle(child.id, isChecked)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </BottomSheet>
      <ConfirmDialog
        isOpen={isConfirming}
        onClose={() => setIsConfirming(false)}
        onConfirm={() => {
          setIsConfirming(false);
          save();
        }}
        title={
          leftEmpty.length === 1
            ? `Leave ${leftEmpty[0].name} with no Assigned Tutors?`
            : `Leave ${leftEmpty.length} Children with no Assigned Tutors?`
        }
        confirmLabel="Save anyway"
        keepLabel="Keep"
        isDestructive
      >
        {first} is the only Assigned Tutor of {joinNames(leftEmpty.map((child) => child.name))}.
        The bot hands their booking requests to the office, and they show in
        To do › Bookings until someone is assigned.
      </ConfirmDialog>
    </>
  );
}
