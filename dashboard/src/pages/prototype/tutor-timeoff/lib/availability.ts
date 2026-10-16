// The kit's AvailabilityEditor speaks day names and "HH:MM"; the API
// speaks day_of_week (0 = Monday) and modes. These convert both ways and
// turn one Save into the per-slot calls the API needs today.
import type {
  AvailabilitySlot,
  SlotLocation,
} from "@/pages/prototype/shared/mock-data";
import type {
  AvailabilityCreate,
  AvailabilityMode,
  AvailabilityRead,
  AvailabilityUpdate,
} from "@/pages/prototype/tutor-timeoff/types/api";

const WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const MODE_LABEL: Record<AvailabilityMode, SlotLocation> = {
  traveler: "Home visits",
  anywhere: "Home or office",
  only_office: "Office only",
};

const LABEL_MODE: Record<SlotLocation, AvailabilityMode> = {
  "Home visits": "traveler",
  "Home or office": "anywhere",
  "Office only": "only_office",
};

export function toEditorSlots(rows: AvailabilityRead[]): AvailabilitySlot[] {
  return rows
    .filter((row) => row.is_active)
    .map((row) => ({
      id: row.id,
      day: WEEK[row.day_of_week],
      from: row.start_time.slice(0, 5),
      to: row.end_time.slice(0, 5),
      location: MODE_LABEL[row.mode],
    }));
}

export type AvailabilityCall =
  | { method: "POST"; body: AvailabilityCreate }
  | { method: "PATCH"; id: string; body: AvailabilityUpdate }
  | { method: "DELETE"; id: string };

// What one Save sends: there is no whole-week endpoint, so it is one
// call per added, changed or removed range.
export function diffWeek(
  before: AvailabilityRead[],
  after: AvailabilitySlot[],
): AvailabilityCall[] {
  const kept = new Map(before.map((row) => [row.id, row]));
  const writes = after.flatMap((slot): AvailabilityCall[] => {
    const row = kept.get(slot.id);
    const body = {
      start_time: `${slot.from}:00`,
      end_time: `${slot.to}:00`,
      mode: LABEL_MODE[slot.location],
    };
    if (!row || row.day_of_week !== WEEK.indexOf(slot.day)) {
      return [{ method: "POST", body: { ...body, day_of_week: WEEK.indexOf(slot.day) } }];
    }
    const isChanged =
      row.start_time !== body.start_time ||
      row.end_time !== body.end_time ||
      row.mode !== body.mode;
    return isChanged ? [{ method: "PATCH", id: row.id, body }] : [];
  });
  const afterIds = new Set(after.map((slot) => slot.id));
  const removals = before
    .filter((row) => !afterIds.has(row.id))
    .map((row): AvailabilityCall => ({ method: "DELETE", id: row.id }));
  return [...removals, ...writes];
}

export function toWireRows(
  tutorId: string,
  slots: AvailabilitySlot[],
): AvailabilityRead[] {
  return slots.map((slot) => ({
    id: slot.id,
    tutor_id: tutorId,
    day_of_week: WEEK.indexOf(slot.day),
    start_time: `${slot.from}:00`,
    end_time: `${slot.to}:00`,
    is_active: true,
    mode: LABEL_MODE[slot.location],
  }));
}
