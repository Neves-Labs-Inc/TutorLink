// The picked Staff member's free times that day as one-tap chips; past
// the first dozen they wait behind "Show {n} more".
import { useState } from "react";
import type { ReactNode } from "react";
import { formatClock } from "@/components/kit/format";
import { TextLink } from "@/components/kit/components/button";
import { Skeleton } from "@/components/kit/states/states";
import { cn } from "@/components/kit/tokens";
import { getSlotKey } from "@/lib/bookings/booking-form";
import type { AvailableSlot } from "@/lib/queries/slots";

const SHOWN_AT_FIRST = 12;
const SKELETON_CHIPS = 4;
const LEGEND = "mb-1.5 text-[14px] leading-5 font-semibold";

type FreeTimeChipsProps = {
  legend: string;
  slots: AvailableSlot[];
  pickedKey: string | null;
  onPick: (slot: AvailableSlot) => void;
  children: ReactNode;
};

export default function FreeTimeChips({
  legend,
  slots,
  pickedKey,
  onPick,
  children,
}: FreeTimeChipsProps): ReactNode {
  const [isAllShown, setIsAllShown] = useState(false);
  const hiddenCount = slots.length - SHOWN_AT_FIRST;
  const shown = isAllShown ? slots : slots.slice(0, SHOWN_AT_FIRST);

  return (
    <fieldset className="kit-rise flex flex-col gap-2">
      <legend className={LEGEND}>{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {shown.map((slot, index) => {
          const isPicked = getSlotKey(slot) === pickedKey;
          return (
            <button
              key={getSlotKey(slot)}
              type="button"
              aria-pressed={isPicked}
              onClick={() => onPick(slot)}
              className={cn(
                "h-11 cursor-pointer rounded-full border px-4 text-[14px] font-medium tabular-nums transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tl-focus)",
                isPicked
                  ? "border-(--tl-primary) bg-(--tl-primary) text-(--tl-on-primary) active:bg-(--tl-primary-hover)"
                  : "border-(--tl-border) bg-(--tl-surface) hover:bg-(--tl-tint) active:bg-(--tl-tint-strong)",
                index >= SHOWN_AT_FIRST && "kit-rise",
              )}
            >
              {formatClock(slot.start_time)}
            </button>
          );
        })}
        {!isAllShown && hiddenCount > 0 && (
          <TextLink onClick={() => setIsAllShown(true)} className="my-0 px-2">
            Show {hiddenCount} more
          </TextLink>
        )}
      </div>
      {children}
    </fieldset>
  );
}

type FreeTimesLoadingProps = { legend: string };

export function FreeTimesLoading({ legend }: FreeTimesLoadingProps): ReactNode {
  return (
    <div className="flex flex-col gap-2">
      <p className={LEGEND}>{legend}</p>
      <div role="status" aria-label="Loading free times" className="flex flex-wrap gap-2">
        {Array.from({ length: SKELETON_CHIPS }, (_, index) => (
          <Skeleton key={index} className="h-11 w-[88px] rounded-full" />
        ))}
      </div>
    </div>
  );
}
