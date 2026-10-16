// A person's own weekly Availability on the kit's one-Edit editor, with
// its fetch states. Used by Tutor ▸ My availability and the Manager's
// profile. One Save is several API calls today (see the report).
import type { ReactNode } from "react";
import { CalendarClock } from "lucide-react";
import { AvailabilityEditor } from "@/pages/prototype/shell-kit/kit/components/availability-editor";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";
import { InlineError, Skeleton } from "@/pages/prototype/shell-kit/kit/states/states";
import { CARD, cn } from "@/pages/prototype/shell-kit/kit/tokens";
import type { AvailabilitySlot } from "@/pages/prototype/shell-kit/kit/mock-data";
import { toEditorSlots } from "@/pages/prototype/tutor-timeoff/lib/availability";
import type { Phase } from "@/pages/prototype/tutor-timeoff/hooks/use-load-phase";
import type { Result } from "@/pages/prototype/tutor-timeoff/hooks/use-area-store";
import type { AvailabilityRead } from "@/pages/prototype/tutor-timeoff/types/api";

const SKELETON_DAYS = 7;

type AvailabilitySectionProps = {
  phase: Phase;
  isRetrying: boolean;
  onRetry: () => void;
  rows: AvailabilityRead[];
  onSave: (slots: AvailabilitySlot[]) => Promise<Result<number>>;
};

export default function AvailabilitySection({
  phase,
  isRetrying,
  onRetry,
  rows,
  onSave,
}: AvailabilitySectionProps): ReactNode {
  const { showToast } = useToast();

  async function handleSave(slots: AvailabilitySlot[]): Promise<void> {
    const result = await onSave(slots);
    showToast(
      result.error
        ? { tone: "error", message: "Couldn’t save your availability. Try again." }
        : { tone: "success", message: "Availability saved. The bot offers the new times now." },
    );
  }

  let content: ReactNode = (
    <div className="flex flex-col gap-4">
      {rows.length === 0 && (
        <p className="flex items-start gap-3 rounded-[18px] bg-(--tl-yellow-tint) px-4 py-3 text-[14px] leading-6 text-(--tl-yellow-ink)">
          <CalendarClock aria-hidden className="mt-1 size-4 shrink-0" />
          You have no availability yet, so the bot can’t offer you to Guardians. Tap Edit to add the
          times you can teach.
        </p>
      )}
      <AvailabilityEditor slots={toEditorSlots(rows)} onSave={handleSave} />
    </div>
  );
  if (phase === "loading") {
    content = (
      <div role="status" aria-label="Loading your availability" className={cn(CARD, "divide-y divide-(--tl-border)")}>
        {Array.from({ length: SKELETON_DAYS }, (_, index) => (
          <div key={index} className="flex items-center gap-6 px-4 py-5 @2xl:px-6">
            <Skeleton className="h-4 w-24 rounded-full" />
            <Skeleton className="h-9 flex-1 rounded-[16px]" />
          </div>
        ))}
      </div>
    );
  } else if (phase === "error") {
    content = (
      <InlineError
        message="Couldn’t load your availability. Check your connection."
        onRetry={onRetry}
        isRetrying={isRetrying}
      />
    );
  }
  return content;
}
