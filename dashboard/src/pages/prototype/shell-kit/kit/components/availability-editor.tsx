// A person's weekly Availability: read-only with one Edit button; Edit
// puts the whole week into edit mode (add, remove or change any time
// range, copy a day to other days), with one Save / Cancel pair for
// everything. Used by Tutor ▸ My availability and the Manager's profile.
// Times are 24h "HH:MM", matching <input type="time">.
import { useId, useState } from "react";
import type { ReactNode } from "react";
import {
  ChevronDown,
  Clock,
  Copy,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { CARD, cn } from "@/pages/prototype/shell-kit/kit/tokens";
import { formatClock } from "@/pages/prototype/shell-kit/kit/format";
import type {
  AvailabilitySlot,
  SlotLocation,
} from "@/pages/prototype/shell-kit/kit/mock-data";
import { SlotLocationBadge } from "@/pages/prototype/shell-kit/kit/components/badges";
import { Button, IconButton, TextLink } from "@/pages/prototype/shell-kit/kit/components/button";
import { CheckboxField } from "@/pages/prototype/shell-kit/kit/components/choices";
import { BottomSheet } from "@/pages/prototype/shell-kit/kit/overlays/bottom-sheet";

const WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const LOCATIONS: SlotLocation[] = ["Home visits", "Home or office", "Office only"];
const NEW_SLOT = { from: "15:00", to: "18:00", location: "Home or office" as const };
const MINUTES_PER_HOUR = 60;

const CONTROL =
  "h-11 rounded-full border border-(--tl-field-border) bg-(--tl-surface) px-3 text-[15px] text-(--tl-ink) tabular-nums hover:border-(--tl-primary)";

function toMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * MINUTES_PER_HOUR + minutes;
}

function isSlotValid(slot: AvailabilitySlot): boolean {
  return toMinutes(slot.to) > toMinutes(slot.from);
}

function sortSlots(slots: AvailabilitySlot[]): AvailabilitySlot[] {
  return [...slots].sort(
    (a, b) =>
      WEEK.indexOf(a.day) - WEEK.indexOf(b.day) || a.from.localeCompare(b.from),
  );
}

function getWeeklyHours(slots: AvailabilitySlot[]): number {
  const minutes = slots.reduce(
    (total, slot) => total + toMinutes(slot.to) - toMinutes(slot.from),
    0,
  );
  return Math.round(minutes / MINUTES_PER_HOUR);
}

type AvailabilityEditorProps = {
  slots: AvailabilitySlot[];
  onSave: (slots: AvailabilitySlot[]) => void;
};

export function AvailabilityEditor({
  slots,
  onSave,
}: AvailabilityEditorProps): ReactNode {
  const [draft, setDraft] = useState<AvailabilitySlot[] | null>(null);
  const [copyFrom, setCopyFrom] = useState<string | null>(null);
  const idPrefix = useId();
  const isEditing = draft !== null;
  const shown = draft ?? slots;
  const invalidCount = shown.filter((slot) => !isSlotValid(slot)).length;

  function updateSlot(id: string, patch: Partial<AvailabilitySlot>): void {
    setDraft((current) =>
      (current ?? []).map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)),
    );
  }

  function addSlot(day: string): void {
    setDraft((current) => [
      ...(current ?? []),
      { id: `${idPrefix}-${Date.now()}`, day, ...NEW_SLOT },
    ]);
  }

  function removeSlot(id: string): void {
    setDraft((current) => (current ?? []).filter((slot) => slot.id !== id));
  }

  function copyDay(fromDay: string, toDays: string[]): void {
    setDraft((current) => {
      const all = current ?? [];
      const source = all.filter((slot) => slot.day === fromDay);
      const kept = all.filter((slot) => !toDays.includes(slot.day));
      const copies = toDays.flatMap((day) =>
        source.map((slot) => ({ ...slot, id: `${slot.id}-${day}`, day })),
      );
      return [...kept, ...copies];
    });
    setCopyFrom(null);
  }

  function handleSave(): void {
    if (!draft || invalidCount > 0) return;
    onSave(sortSlots(draft));
    setDraft(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-(--tl-muted)">
          {isEditing
            ? "Editing your whole week. Nothing changes until you save."
            : `${shown.length} time ranges · about ${getWeeklyHours(shown)} hours a week`}
        </p>
        {!isEditing && (
          <Button icon={Pencil} onClick={() => setDraft(slots)}>
            Edit
          </Button>
        )}
      </div>

      <ul className={cn(CARD, "@container divide-y divide-(--tl-border) overflow-hidden")}>
        {WEEK.map((day) => {
          const daySlots = sortSlots(shown.filter((slot) => slot.day === day));
          return (
            <li
              key={day}
              className={cn(
                "flex flex-col gap-3 px-4 py-4 @2xl:flex-row @2xl:items-start @2xl:gap-6 @2xl:px-6",
                isEditing && "bg-(--tl-surface)",
              )}
            >
              <div className="flex items-center justify-between gap-2 @2xl:w-36 @2xl:shrink-0 @2xl:flex-col @2xl:items-start @2xl:pt-2.5">
                <h3 className="kit-display text-[17px] leading-6 font-bold">{day}</h3>
                {isEditing && daySlots.length > 0 && (
                  <TextLink onClick={() => setCopyFrom(day)} className="text-[13px]">
                    <Copy aria-hidden className="size-3.5" />
                    Copy to…
                  </TextLink>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {daySlots.length === 0 && !isEditing && (
                  <p className="pt-2 text-[14px] text-(--tl-muted)">Not available</p>
                )}
                {daySlots.map((slot, index) =>
                  isEditing ? (
                    <EditRow
                      key={slot.id}
                      slot={slot}
                      label={`${day} range ${index + 1}`}
                      onChange={(patch) => updateSlot(slot.id, patch)}
                      onRemove={() => removeSlot(slot.id)}
                    />
                  ) : (
                    <div
                      key={slot.id}
                      className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-[16px] bg-(--tl-surface-sunk) px-4 py-1.5"
                    >
                      <span className="flex items-center gap-2 text-[15px] font-semibold tabular-nums">
                        <Clock aria-hidden className="size-4 text-(--tl-muted)" />
                        {formatClock(slot.from)} – {formatClock(slot.to)}
                      </span>
                      <SlotLocationBadge location={slot.location} />
                    </div>
                  ),
                )}
                {isEditing && (
                  <div>
                    <TextLink onClick={() => addSlot(day)}>
                      <Plus aria-hidden className="size-4" />
                      {daySlots.length === 0 ? "Add a time range" : "Add another"}
                    </TextLink>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {isEditing && (
        <div className="kit-shadow-raised sticky bottom-[92px] z-10 flex flex-wrap items-center gap-3 rounded-[24px] border border-(--tl-card-border) bg-(--tl-surface) p-3 @5xl:bottom-4">
          {invalidCount > 0 ? (
            <p className="flex flex-1 items-center gap-2 pl-1 text-[13px] font-medium text-(--tl-danger)">
              <TriangleAlert aria-hidden className="size-4 shrink-0" />
              Fix {invalidCount} {invalidCount === 1 ? "range" : "ranges"} that end before they start.
            </p>
          ) : (
            <p className="hidden flex-1 pl-1 text-[13px] text-(--tl-muted) @2xl:block">
              Guardians see the new times as soon as you save.
            </p>
          )}
          <div className="ml-auto flex gap-2">
            <Button onClick={() => setDraft(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={invalidCount > 0}
            >
              Save
            </Button>
          </div>
        </div>
      )}

      <CopyDaySheet
        fromDay={copyFrom}
        onClose={() => setCopyFrom(null)}
        onApply={copyDay}
      />
    </div>
  );
}

type EditRowProps = {
  slot: AvailabilitySlot;
  label: string;
  onChange: (patch: Partial<AvailabilitySlot>) => void;
  onRemove: () => void;
};

function EditRow({ slot, label, onChange, onRemove }: EditRowProps): ReactNode {
  const isValid = isSlotValid(slot);
  const errorId = useId();
  return (
    <div
      className={cn(
        "rounded-[18px] border p-2",
        isValid
          ? "border-(--tl-border) bg-(--tl-surface-sunk)"
          : "border-(--tl-danger) bg-(--tl-danger-tint)",
      )}
    >
      {/* Phones: times on one line, place + remove on the next. From
          672px of list width it's all one line. */}
      <div className="flex flex-col gap-2 @2xl:flex-row @2xl:items-center">
        <div className="flex items-center gap-2">
          <input
            type="time"
            aria-label={`${label} starts`}
            value={slot.from}
            onChange={(event) => onChange({ from: event.target.value })}
            className={cn(CONTROL, "min-w-0 flex-1 @2xl:w-[152px] @2xl:flex-none")}
          />
          <span aria-hidden className="text-(--tl-muted)">
            –
          </span>
          <input
            type="time"
            aria-label={`${label} ends`}
            aria-invalid={isValid ? undefined : true}
            aria-describedby={isValid ? undefined : errorId}
            value={slot.to}
            onChange={(event) => onChange({ to: event.target.value })}
            className={cn(
              CONTROL,
              "min-w-0 flex-1 @2xl:w-[152px] @2xl:flex-none",
              !isValid && "border-(--tl-danger)",
            )}
          />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <select
              aria-label={`${label} location`}
              value={slot.location}
              // Options come from LOCATIONS, so the value is a SlotLocation.
              onChange={(event) => onChange({ location: event.target.value as SlotLocation })}
              className={cn(CONTROL, "w-full cursor-pointer pr-10 pl-4")}
            >
              {LOCATIONS.map((location) => (
                <option key={location} value={location}>
                  {location}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-(--tl-muted)"
            />
          </div>
          <IconButton icon={Trash2} label={`Remove ${label}`} onClick={onRemove} />
        </div>
      </div>
      {!isValid && (
        <p id={errorId} className="px-2 pt-1.5 text-[13px] font-medium text-(--tl-danger)">
          Ends before it starts. Pick a later end time.
        </p>
      )}
    </div>
  );
}

type CopyDaySheetProps = {
  fromDay: string | null;
  onClose: () => void;
  onApply: (fromDay: string, toDays: string[]) => void;
};

function CopyDaySheet({ fromDay, onClose, onApply }: CopyDaySheetProps): ReactNode {
  const [targets, setTargets] = useState<string[]>([]);
  const otherDays = WEEK.filter((day) => day !== fromDay);

  function handleApply(): void {
    if (!fromDay) return;
    onApply(fromDay, targets);
    setTargets([]);
  }

  return (
    <BottomSheet
      isOpen={fromDay !== null}
      onClose={onClose}
      title={`Copy ${fromDay ?? ""}’s times`}
      description="The days you pick get the same ranges. Their current times are replaced."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleApply} disabled={targets.length === 0}>
            {targets.length > 0 ? `Copy to ${targets.length} ${targets.length === 1 ? "day" : "days"}` : "Copy"}
          </Button>
        </>
      }
    >
      <fieldset className="flex flex-col">
        <legend className="sr-only">Copy to</legend>
        {otherDays.map((day) => (
          <CheckboxField
            key={day}
            label={day}
            isChecked={targets.includes(day)}
            onChange={(isChecked) =>
              setTargets((current) =>
                isChecked ? [...current, day] : current.filter((item) => item !== day),
              )
            }
          />
        ))}
      </fieldset>
    </BottomSheet>
  );
}
