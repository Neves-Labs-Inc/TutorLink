// A person's weekly Availability: read-only with one Edit button; Edit
// puts the whole week into edit mode (add, remove or change any time
// range, copy a day to other days), with one Save / Cancel pair for
// everything. Save is async: it stays in edit mode, edits kept, when the
// save fails. Used by My availability, the Manager's profile and Staff
// details.
// Times are 24h "HH:MM", matching <input type="time">.
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  CircleAlert,
  Clock,
  Copy,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { CARD, cn } from "@/components/kit/tokens";
import { formatClock } from "@/components/kit/format";
import type {
  AvailabilitySlot,
  SlotLocation,
} from "@/components/kit/types/domain";
import { SlotLocationBadge } from "@/components/kit/components/badges";
import { Button, IconButton, TextLink } from "@/components/kit/components/button";
import { CheckboxField } from "@/components/kit/components/choices";
import Select from "@/components/kit/components/select";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";

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
const LOCATION_OPTIONS = LOCATIONS.map((location) => ({
  value: location,
  label: location,
}));
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
  // A rejection keeps the week in edit mode, edits intact, with an alert.
  onSave: (slots: AvailabilitySlot[]) => Promise<void> | void;
  // No Edit: a Manager viewing someone else's week.
  isReadOnly?: boolean;
  // The owner's first name; left out, it is the viewer's own week.
  ownerName?: string;
  // Inside a DetailOverlay there is no tab bar for the save bar to clear.
  isInOverlay?: boolean;
};

type FocusTarget = "first-control" | "edit" | "save";

const FOCUS_SELECTORS: Record<FocusTarget, string> = {
  // The first day's first time input, or its "Add a time range".
  "first-control": "li:first-child :is(input, [data-add-range])",
  edit: "[data-edit-button]",
  save: "[data-save-button]",
};

export function AvailabilityEditor({
  slots,
  onSave,
  isReadOnly = false,
  ownerName,
  isInOverlay = false,
}: AvailabilityEditorProps): ReactNode {
  const [draft, setDraft] = useState<AvailabilitySlot[] | null>(null);
  const [copyFrom, setCopyFrom] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasSaveFailed, setHasSaveFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Set alongside the state change that swaps the content in.
  const pendingFocus = useRef<FocusTarget | null>(null);
  const idPrefix = useId();
  const isEditing = draft !== null;
  const shown = draft ?? slots;
  const invalidCount = shown.filter((slot) => !isSlotValid(slot)).length;

  // Focus moves after the swap renders, so the target exists and is enabled.
  useEffect(() => {
    if (pendingFocus.current === null) return;
    rootRef.current
      ?.querySelector<HTMLElement>(FOCUS_SELECTORS[pendingFocus.current])
      ?.focus();
    pendingFocus.current = null;
  });

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

  function handleEdit(): void {
    setDraft(slots);
    pendingFocus.current = "first-control";
  }

  function handleCancel(): void {
    setDraft(null);
    setHasSaveFailed(false);
    pendingFocus.current = "edit";
  }

  async function handleSave(): Promise<void> {
    if (!draft || invalidCount > 0 || isSaving) return;
    setIsSaving(true);
    setHasSaveFailed(false);
    try {
      await onSave(sortSlots(draft));
      setDraft(null);
      pendingFocus.current = "edit";
    } catch {
      // The caller owns the reason; the person keeps their edits and retries.
      setHasSaveFailed(true);
      pendingFocus.current = "save";
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-(--tl-muted)">
          {isEditing ? getEditingLine(ownerName) : getSummary(shown)}
        </p>
        {!isEditing && !isReadOnly && (
          <Button data-edit-button icon={Pencil} onClick={handleEdit}>
            Edit
          </Button>
        )}
      </div>

      {/* One switch for every control while a save runs. */}
      <fieldset disabled={isSaving} className="min-w-0">
        <legend className="sr-only">Weekly availability</legend>
        <ul
          className={cn(CARD, "@container divide-y divide-(--tl-border) overflow-hidden")}
        >
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
                {/* Edit rows switch to one line by this column's width, not the
                    list's: beside the day column a 720px list is too narrow. */}
                <div className="@container/ranges flex min-w-0 flex-1 flex-col gap-2">
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
                      <TextLink data-add-range onClick={() => addSlot(day)}>
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
      </fieldset>

      {isEditing && (
        <div
          data-save-bar
          className={cn(
            "kit-shadow-raised kit-rise sticky z-10 flex flex-wrap items-center gap-3 rounded-[28px] border border-(--tl-card-border) bg-(--tl-surface) p-3 motion-reduce:animate-none",
            isInOverlay ? "bottom-4" : "bottom-[92px] @5xl:bottom-4",
          )}
        >
          <SaveBarLine invalidCount={invalidCount} hasSaveFailed={hasSaveFailed} />
          <div className="ml-auto flex gap-2">
            <Button onClick={handleCancel} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              data-save-button
              variant="primary"
              onClick={() => void handleSave()}
              disabled={invalidCount > 0}
              isLoading={isSaving}
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

function getEditingLine(ownerName: string | undefined): string {
  const whose = ownerName ? `${ownerName}’s` : "your";
  return `Editing ${whose} whole week. Nothing changes until you save.`;
}

function getSummary(slots: AvailabilitySlot[]): string {
  if (slots.length === 0) return "No time ranges yet";
  const ranges = slots.length === 1 ? "time range" : "time ranges";
  return `${slots.length} ${ranges} · about ${getWeeklyHours(slots)} hours a week`;
}

type SaveBarLineProps = { invalidCount: number; hasSaveFailed: boolean };

// The save bar's left line: the invalid-range error, the save error, or
// the hint. The hint hides below 672px; the errors show at every width.
function SaveBarLine({ invalidCount, hasSaveFailed }: SaveBarLineProps): ReactNode {
  const errorClasses =
    "flex flex-1 items-center gap-2 pl-1 text-[13px] font-medium text-(--tl-danger)";
  let line: ReactNode = (
    <p className="hidden flex-1 pl-1 text-[13px] text-(--tl-muted) @2xl:block">
      Guardians see the new times as soon as you save.
    </p>
  );
  if (invalidCount > 0) {
    line = (
      <p className={errorClasses}>
        <TriangleAlert aria-hidden className="size-4 shrink-0" />
        {invalidCount === 1
          ? "Fix 1 range that ends before it starts."
          : `Fix ${invalidCount} ranges that end before they start.`}
      </p>
    );
  } else if (hasSaveFailed) {
    line = (
      <p role="alert" className={errorClasses}>
        <CircleAlert aria-hidden className="size-4 shrink-0" />
        Couldn’t save the availability. Check your connection and try again.
      </p>
    );
  }
  return line;
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
        "rounded-[16px] border p-2",
        isValid
          ? "border-(--tl-border) bg-(--tl-surface-sunk)"
          : "border-(--tl-danger) bg-(--tl-danger-tint)",
      )}
    >
      {/* Phones: times on one line, place + remove on the next. From
          672px of list width it's all one line. */}
      <div className="flex flex-col gap-2 @[34rem]/ranges:flex-row @[34rem]/ranges:items-center">
        <div className="flex items-center gap-2">
          <input
            type="time"
            aria-label={`${label} starts`}
            value={slot.from}
            onChange={(event) => onChange({ from: event.target.value })}
            className={cn(CONTROL, "min-w-0 flex-1 @[34rem]/ranges:w-[152px] @[34rem]/ranges:flex-none")}
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
              "min-w-0 flex-1 @[34rem]/ranges:w-[152px] @[34rem]/ranges:flex-none",
              !isValid && "border-(--tl-danger)",
            )}
          />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Select
              aria-label={`${label} location`}
              label="Location"
              options={LOCATION_OPTIONS}
              value={slot.location}
              // Options come from LOCATIONS, so the value is a SlotLocation.
              onValueChange={(location) => onChange({ location: location as SlotLocation })}
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
