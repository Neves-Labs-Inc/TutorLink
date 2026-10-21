// A person's weekly Availability with its load states, on the kit's
// one-Edit editor. Used by My availability, the Manager's profile and
// Staff details ▸ Availability.
import type { ReactNode } from "react";
import { CalendarClock } from "lucide-react";
import { AvailabilityEditor } from "@/components/kit/components/availability-editor";
import type { AvailabilitySlot } from "@/components/kit/types/domain";
import { useToast } from "@/components/kit/overlays/use-toast";
import { InlineError } from "@/components/kit/states/states";
import { useAvailabilityWeek } from "@/hooks/use-availability-week";
import { toEditorSlots } from "@/lib/availability/availability-week";
import AvailabilitySkeleton from "@/pages/availability/components/availability-skeleton";

type AvailabilitySectionProps = {
  tutorId: string;
  // The owner's first name; left out, it is the viewer's own week.
  ownerName?: string;
  isReadOnly?: boolean;
  isInOverlay?: boolean;
};

export default function AvailabilitySection({
  tutorId,
  ownerName,
  isReadOnly = false,
  isInOverlay = false,
}: AvailabilitySectionProps): ReactNode {
  const { week, save } = useAvailabilityWeek(tutorId);
  const { showToast } = useToast();
  // v5 resets a failed query to pending while it retries; the error stays up meanwhile.
  const hasFailed = !week.data && (week.isError || week.errorUpdateCount > 0);

  async function handleSave(slots: AvailabilitySlot[]): Promise<void> {
    // A rejection reaches the editor, which keeps the edits and shows the alert.
    await save.mutateAsync(slots);
    showToast({ tone: "success", message: getSavedMessage(ownerName) });
  }

  let content: ReactNode = <AvailabilitySkeleton isEditable={!isReadOnly} />;
  if (week.data) {
    const slots = toEditorSlots(week.data.items);
    content = (
      <div className="flex flex-col gap-4">
        {slots.length === 0 && (
          <p className="flex items-start gap-3 rounded-[16px] bg-(--tl-yellow-tint) px-4 py-3 text-[14px] leading-6 text-(--tl-yellow-ink)">
            <CalendarClock aria-hidden className="mt-1 size-4 shrink-0" />
            {getEmptyNote(ownerName, isReadOnly)}
          </p>
        )}
        <AvailabilityEditor
          slots={slots}
          onSave={handleSave}
          isReadOnly={isReadOnly}
          ownerName={ownerName}
          isInOverlay={isInOverlay}
        />
      </div>
    );
  } else if (hasFailed) {
    content = (
      <InlineError
        message="Couldn’t load the availability. Check your connection and try again."
        onRetry={() => void week.refetch()}
        isRetrying={week.isFetching}
      />
    );
  }
  return content;
}

function getEmptyNote(ownerName: string | undefined, isReadOnly: boolean): string {
  const lead = ownerName
    ? `${ownerName} has no availability yet, so the bot can’t offer them to Guardians.`
    : "You have no availability yet, so the bot can’t offer you to Guardians.";
  const nudge = ownerName
    ? "Tap Edit to add the times they can teach."
    : "Tap Edit to add the times you can teach.";
  return isReadOnly ? lead : `${lead} ${nudge}`;
}

function getSavedMessage(ownerName: string | undefined): string {
  return ownerName
    ? `${ownerName}’s Availability saved.`
    : "Availability saved. The bot offers the new times now.";
}
