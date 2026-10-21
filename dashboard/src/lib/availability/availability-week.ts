// The kit's AvailabilityEditor speaks day names, "HH:MM" and place
// labels; the API speaks day_of_week (0 = Monday), "HH:MM:SS" and modes.
import type {
  AvailabilitySlot as EditorSlot,
  SlotLocation,
} from "@/components/kit/types/domain";
import type {
  AvailabilityMode,
  AvailabilitySlot as WireSlot,
} from "@/lib/queries/availability";
import type { AvailabilityWeek } from "@/lib/queries/availability-week";

const WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const LOCATION_BY_MODE: Record<AvailabilityMode, SlotLocation> = {
  traveler: "Home visits",
  anywhere: "Home or office",
  only_office: "Office only",
};

const MODE_BY_LOCATION: Record<SlotLocation, AvailabilityMode> = {
  "Home visits": "traveler",
  "Home or office": "anywhere",
  "Office only": "only_office",
};

// "HH:MM:SS" → "HH:MM".
const CLOCK_LENGTH = 5;
const ZERO_SECONDS = ":00";

export function toEditorSlots(rows: WireSlot[]): EditorSlot[] {
  return rows
    .filter((row) => row.is_active)
    .map((row) => ({
      id: row.id,
      day: WEEK[row.day_of_week],
      from: row.start_time.slice(0, CLOCK_LENGTH),
      to: row.end_time.slice(0, CLOCK_LENGTH),
      location: LOCATION_BY_MODE[row.mode],
    }));
}

export function toWeekPayload(slots: EditorSlot[]): AvailabilityWeek {
  return {
    slots: slots.map((slot) => ({
      day_of_week: WEEK.indexOf(slot.day),
      start_time: `${slot.from}${ZERO_SECONDS}`,
      end_time: `${slot.to}${ZERO_SECONDS}`,
      mode: MODE_BY_LOCATION[slot.location],
    })),
  };
}
