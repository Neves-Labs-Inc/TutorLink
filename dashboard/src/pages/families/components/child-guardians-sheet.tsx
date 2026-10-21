// Change guardians: the Child's Guardians, each with Unlink (not on the
// last one), and a picker to link another active Guardian.
import { useId, useRef } from "react";
import type { ReactNode } from "react";
import { Link2 } from "lucide-react";
import { Avatar } from "@/components/kit/components/badges";
import { Button } from "@/components/kit/components/button";
import { Combobox } from "@/components/kit/components/combobox";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import { InlineError, Skeleton } from "@/components/kit/states/states";
import { cn, EYEBROW } from "@/components/kit/tokens";
import { getFirstName } from "@/lib/families/child-labels";
import { formatPhone } from "@/lib/families/guardian-labels";
import SheetFailureLine from "@/pages/families/components/sheet-failure-line";
import { useChildGuardians } from "@/pages/families/hooks/use-child-guardians";
import type { ChildGuardians } from "@/pages/families/hooks/use-child-guardians";
import type { ChildDetail, ChildGuardianRead } from "@/types/families";

const PICKER_LABEL = "Guardian";

type ChildGuardiansSheetProps = {
  child: ChildDetail;
  isOpen: boolean;
  onClose: () => void;
};

export default function ChildGuardiansSheet({
  child,
  isOpen,
  onClose,
}: ChildGuardiansSheetProps): ReactNode {
  const hintId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const guardians = useChildGuardians(child, isOpen);
  const isLastGuardian = child.guardians.length <= 1;

  async function handleUnlink(guardian: ChildGuardianRead): Promise<void> {
    const isUnlinked = await guardians.unlink(guardian);
    // Its button left with the row: keep focus in the list.
    if (isUnlinked) listRef.current?.focus();
  }

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={`Guardians of ${getFirstName(child.name)}`}
      footer={
        <Button variant="soft" onClick={onClose}>
          Done
        </Button>
      }
    >
      <ul
        ref={listRef}
        aria-label="Linked Guardians"
        tabIndex={-1}
      >
        {child.guardians.map((guardian) => (
          <li
            key={guardian.id}
            className={cn(
              "flex min-h-[64px] items-center gap-3 border-b border-(--tl-border) py-2 last:border-b-0",
              guardian.id === guardians.linkedId && "kit-rise",
            )}
          >
            <Avatar name={guardian.name} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] leading-6 font-semibold">
                {guardian.name}
              </span>
              <span className="block text-[13px] leading-[18px] text-(--tl-muted) tabular-nums">
                {formatPhone(guardian.phone_number)}
              </span>
            </span>
            <Button
              variant="outline"
              aria-label={`Unlink ${guardian.name}`}
              aria-describedby={isLastGuardian ? hintId : undefined}
              // The in-flight row keeps its spinner (isLoading wins).
              disabled={isLastGuardian || guardians.isBusy}
              isLoading={guardian.id === guardians.unlinkingId}
              onClick={() => void handleUnlink(guardian)}
            >
              Unlink
            </Button>
          </li>
        ))}
      </ul>
      {isLastGuardian && (
        <p id={hintId} className="mt-2 text-[13px] leading-[18px] text-(--tl-muted)">
          A Child needs at least one Guardian.
        </p>
      )}
      <h3 className={cn(EYEBROW, "mt-6 mb-2")}>Link a guardian</h3>
      <LinkPicker guardians={guardians} />
      {guardians.failure && (
        <div className="mt-4">
          <SheetFailureLine message={guardians.failure} />
        </div>
      )}
    </BottomSheet>
  );
}

type LinkPickerProps = { guardians: ChildGuardians };

function LinkPicker({ guardians }: LinkPickerProps): ReactNode {
  const { candidates } = guardians;
  // v5 puts a failed query back to pending while it retries.
  const hasFailed =
    !candidates.data && (candidates.isError || candidates.errorUpdateCount > 0);

  let picker: ReactNode;
  if (candidates.data) {
    picker = (
      <div className="flex flex-col gap-2 @md:flex-row @md:items-end">
        <div className="min-w-0 flex-1">
          <Combobox
            label={PICKER_LABEL}
            placeholder="Search by name or phone"
            options={guardians.options.map((candidate) => ({
              value: candidate.id,
              label: candidate.name,
              description: formatPhone(candidate.phone_number),
              hasAvatar: true,
            }))}
            value={guardians.pickedId}
            onChange={guardians.pick}
            emptyText="No other active Guardians."
          />
        </div>
        <Button
          variant="soft"
          icon={Link2}
          disabled={guardians.pickedId === null || guardians.unlinkingId !== null}
          isLoading={guardians.isLinking}
          onClick={guardians.link}
        >
          Link guardian
        </Button>
      </div>
    );
  } else if (hasFailed) {
    picker = (
      <InlineError
        message="Couldn’t load Guardians. Check your connection."
        onRetry={() => void candidates.refetch()}
        isRetrying={candidates.isFetching}
      />
    );
  } else {
    picker = (
      <div
        role="status"
        aria-label="Loading Guardians"
        className="flex flex-col gap-1.5"
      >
        <span className="text-[14px] leading-5 font-semibold">{PICKER_LABEL}</span>
        <Skeleton className="h-11 rounded-full" />
      </div>
    );
  }
  return picker;
}
