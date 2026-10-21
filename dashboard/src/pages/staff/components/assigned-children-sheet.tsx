// Staff › Children › Change: tick the live Evaluated Children this Tutor
// or Manager is an Assigned Tutor of. Save applies at once, no confirm.
import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/kit/components/button";
import { CheckboxField } from "@/components/kit/components/choices";
import { SearchInput } from "@/components/kit/components/fields";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import {
  FormAlert,
  InlineError,
  Skeleton,
} from "@/components/kit/states/states";
import type { StaffRead } from "@/lib/queries/staff";
import type { EvaluatedChild } from "@/lib/queries/assigned-children";
import { useAssignedChildrenSheet } from "@/pages/staff/hooks/use-assigned-children-sheet";
import {
  describeChild,
  getFirstName,
} from "@/pages/staff/lib/assigned-children";

const LOADING_ROWS = 5;
const WELL =
  "rounded-[16px] bg-(--tl-surface-sunk) px-4 py-3 text-[14px] text-(--tl-muted)";

function Well({ children }: { children: string }): ReactNode {
  return <p className={WELL}>{children}</p>;
}

// The list's height, or less when the sheet body shows only part of it.
function getVisibleHeight(list: HTMLElement): number {
  let body = list.parentElement;
  while (body && getComputedStyle(body).overflowY !== "auto") {
    body = body.parentElement;
  }
  if (!body) return list.offsetHeight;

  const room =
    body.getBoundingClientRect().bottom - list.getBoundingClientRect().top;
  return Math.max(0, Math.min(list.offsetHeight, room));
}

type ChildOptionsProps = {
  matches: EvaluatedChild[];
  staff: StaffRead;
  isSelected: (childId: string) => boolean;
  onToggle: (childId: string, isChecked: boolean) => void;
};

function ChildOptions({
  matches,
  staff,
  isSelected,
  onToggle,
}: ChildOptionsProps): ReactNode {
  const first = getFirstName(staff.name);
  return (
    <ul className="flex flex-col">
      {matches.map((child) => {
        const hasOthers = child.assigned_tutors.some(
          (tutor) => tutor.id !== staff.id,
        );
        const isChecked = isSelected(child.id);
        const onlySuffix =
          isChecked && !hasOthers ? ` · ${first} is their only Assigned Tutor` : "";
        return (
          <li key={child.id}>
            <CheckboxField
              label={child.name}
              description={`${describeChild(child, staff)}${onlySuffix}`}
              isChecked={isChecked}
              onChange={(next) => onToggle(child.id, next)}
            />
          </li>
        );
      })}
    </ul>
  );
}

type AssignedChildrenSheetProps = {
  isOpen: boolean;
  staff: StaffRead;
  onClose: () => void;
};

export default function AssignedChildrenSheet({
  isOpen,
  staff,
  onClose,
}: AssignedChildrenSheetProps): ReactNode {
  const sheet = useAssignedChildrenSheet(staff, onClose);
  const first = getFirstName(staff.name);
  const listRef = useRef<HTMLDivElement>(null);
  // The list keeps its first height while a search narrows it, so the
  // sheet doesn't jump; capped at the room the sheet shows it.
  const [listMinHeight, setListMinHeight] = useState<number | null>(null);
  const hasMatches = sheet.matches.length > 0;
  useLayoutEffect(() => {
    if (listMinHeight !== null || !hasMatches || !listRef.current) return;
    setListMinHeight(getVisibleHeight(listRef.current));
  }, [hasMatches, listMinHeight]);

  let list: ReactNode;
  if (sheet.hasFailed) {
    list = (
      <InlineError
        message="Couldn’t load the Children. Check your connection and try again."
        onRetry={sheet.retry}
        isRetrying={sheet.isRetrying}
      />
    );
  } else if (!sheet.candidates) {
    list = (
      <div role="status" aria-label="Loading Children" className="flex flex-col gap-2">
        {Array.from({ length: LOADING_ROWS }, (_, index) => (
          <Skeleton key={index} className="h-14 rounded-[14px]" />
        ))}
      </div>
    );
  } else if (sheet.candidates.length === 0) {
    list = <Well>No Evaluated Children yet.</Well>;
  } else if (!hasMatches) {
    list = <Well>No Children match.</Well>;
  } else {
    list = (
      <ChildOptions
        matches={sheet.matches}
        staff={staff}
        isSelected={sheet.isSelected}
        onToggle={sheet.toggle}
      />
    );
  }

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={sheet.close}
      title={`${first}’s Children`}
      description={`The Children ${first} is an Assigned Tutor of. The bot may book them with ${first}.`}
      footer={
        <>
          <Button onClick={sheet.close} disabled={sheet.isSaving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={sheet.save}
            isLoading={sheet.isSaving}
            disabled={!sheet.candidates}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Pinned while the list scrolls; -top-4 covers the body's top
            padding too, so no row shows above it. The save's alert sits
            here so it is never scrolled out of sight. */}
        <div className="sticky -top-4 z-10 -mt-4 flex flex-col gap-3 bg-(--tl-surface) pt-4 pb-1">
          <SearchInput
            label="Search Children"
            placeholder="Child or Guardian"
            value={sheet.search}
            onChange={sheet.setSearch}
          />
          <p className="px-1 text-[13px] leading-[18px] text-(--tl-muted)">
            Only Evaluated Children are listed: Mark Evaluated sets a Child’s
            first Assigned Tutors.
          </p>
          {sheet.hasPartlyFailed && (
            <FormAlert
              tone="danger"
              title="Some changes didn’t save. Check the list and try again."
            />
          )}
        </div>
        <fieldset
          disabled={sheet.isSaving}
          className="min-w-0 transition-opacity duration-150 disabled:opacity-60"
        >
          <legend className="sr-only">Children</legend>
          <div
            ref={listRef}
            style={listMinHeight === null ? undefined : { minHeight: listMinHeight }}
          >
            {list}
          </div>
        </fieldset>
      </div>
    </BottomSheet>
  );
}
