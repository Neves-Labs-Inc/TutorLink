// Availability: Admins edit the week with the kit's one-Edit editor
// (only an Admin sets someone else's Availability). Managers get a
// read-only week, since the kit editor has no read-only mode.
import type { ReactNode } from "react";
import { Clock } from "lucide-react";
import type { AvailabilitySlot } from "@/pages/prototype/shared/mock-data";
import { CARD, cn } from "@/components/kit/tokens";
import { SlotLocationBadge } from "@/components/kit/components/badges";
import { AvailabilityEditor } from "@/components/kit/components/availability-editor";
import { useToast } from "@/components/kit/overlays/use-toast";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import {
  formatWireTime,
  getModeFromLabel,
  getModeLabel,
  WEEK_DAYS,
} from "@/pages/prototype/accounts-staff/lib/labels";
import { listAvailability } from "@/pages/prototype/accounts-staff/lib/mock-api";
import type {
  AvailabilityRead,
  StaffRead,
} from "@/pages/prototype/accounts-staff/types/api";

function toEditorSlot(slot: AvailabilityRead): AvailabilitySlot {
  return {
    id: slot.id,
    day: WEEK_DAYS[slot.day_of_week],
    from: slot.start_time.slice(0, 5),
    to: slot.end_time.slice(0, 5),
    location: getModeLabel(slot.mode),
  };
}

function toWireSlot(slot: AvailabilitySlot, tutorId: string): AvailabilityRead {
  return {
    id: slot.id,
    tutor_id: tutorId,
    day_of_week: WEEK_DAYS.indexOf(slot.day),
    start_time: `${slot.from}:00`,
    end_time: `${slot.to}:00`,
    is_active: true,
    mode: getModeFromLabel(slot.location),
  };
}

type StaffAvailabilityTabProps = { staff: StaffRead; canEdit: boolean };

export default function StaffAvailabilityTab({ staff, canEdit }: StaffAvailabilityTabProps): ReactNode {
  const { db, setAvailability } = useArea();
  const { showToast } = useToast();
  const tutorId = staff.tutor_id;
  if (!tutorId) return null;
  const slots = listAvailability(db, tutorId);

  if (canEdit) {
    return (
      <AvailabilityEditor
        slots={slots.map(toEditorSlot)}
        onSave={(next) => {
          setAvailability(tutorId, next.map((slot) => toWireSlot(slot, tutorId)));
          showToast({ tone: "success", message: `${staff.name}’s Availability saved.` });
        }}
      />
    );
  }

  return (
    <ul className={cn(CARD, "divide-y divide-(--tl-border) overflow-hidden")}>
      {WEEK_DAYS.map((day, index) => {
        const daySlots = slots
          .filter((slot) => slot.day_of_week === index)
          .sort((a, b) => a.start_time.localeCompare(b.start_time));
        return (
          <li key={day} className="flex flex-col gap-2 px-4 py-3">
            <h4 className="kit-display text-[16px] leading-6 font-bold">{day}</h4>
            {daySlots.length === 0 ? (
              <p className="text-[14px] text-(--tl-muted)">Not available</p>
            ) : (
              daySlots.map((slot) => (
                <div key={slot.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[16px] bg-(--tl-surface-sunk) px-4 py-2">
                  <span className="flex items-center gap-2 text-[15px] font-semibold tabular-nums">
                    <Clock aria-hidden className="size-4 text-(--tl-muted)" />
                    {formatWireTime(slot.start_time)} – {formatWireTime(slot.end_time)}
                  </span>
                  <SlotLocationBadge location={getModeLabel(slot.mode)} />
                </div>
              ))
            )}
          </li>
        );
      })}
    </ul>
  );
}
