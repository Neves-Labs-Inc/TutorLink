// New booking and Change booking, in the same slide-over (a pushed page
// on phones). The order follows the job: who (Kind, Child, Subject),
// when (Date), with whom (Staff, with each one's free time that day),
// what time (free times as one-tap chips, or any other time), where.
// Change booking locks the Child and Kind (PUT refuses both).
import type { ReactNode } from "react";
import { CircleAlert, Plane, TriangleAlert } from "lucide-react";
import { Badge, KindBadge } from "@/pages/prototype/shell-kit/kit/components/badges";
import { Button, TextLink } from "@/pages/prototype/shell-kit/kit/components/button";
import { RadioCards } from "@/pages/prototype/shell-kit/kit/components/choices";
import { Combobox } from "@/pages/prototype/shell-kit/kit/components/combobox";
import {
  SelectField,
  TextAreaField,
  TextField,
} from "@/pages/prototype/shell-kit/kit/components/fields";
import { SegmentedControl } from "@/pages/prototype/shell-kit/kit/components/tabs";
import { DetailOverlay } from "@/pages/prototype/shell-kit/kit/overlays/detail-overlay";
import { cn } from "@/pages/prototype/shell-kit/kit/tokens";
import { useBookingForm } from "@/pages/prototype/bookings/hooks/use-booking-form";
import type {
  BookingFormState,
  FieldName,
  FormStart,
} from "@/pages/prototype/bookings/hooks/use-booking-form";
import { SESSION_MINUTES, TODAY } from "@/pages/prototype/bookings/lib/mock-data";
import {
  formatDay,
  formatGrade,
  formatTime,
  getDaysSince,
  getFirstName,
  KIND_LABEL,
  pluralize,
} from "@/pages/prototype/bookings/lib/format";
import { findTimeOff, getFreeSlots } from "@/pages/prototype/bookings/lib/rules";
import type {
  BookingCreate,
  BookingDetail,
  StaffRead,
} from "@/pages/prototype/bookings/lib/wire";

const FIELD_ERRORS: Record<FieldName, string> = {
  child: "Pick a Child.",
  subject: "Pick a Subject.",
  staff: "Pick who teaches it.",
  date: "Pick a date.",
  time: "Pick a free time, or set a start and end time.",
  home: "Pick which home.",
};

function getError(form: BookingFormState, field: FieldName): string | undefined {
  return form.showsErrors && form.missing.includes(field) ? FIELD_ERRORS[field] : undefined;
}

function describeStaff(
  staff: StaffRead,
  form: BookingFormState,
  bookings: BookingDetail[],
  editingId: string | null,
): string {
  const { fields } = form;
  const subjectName =
    form.child?.levels.find((level) => level.subject_id === fields.subjectId)?.name ?? "";
  const isOff = findTimeOff({ userId: staff.id, date: fields.date, start: "00:00:00", end: "23:59:00" });
  if (isOff) return `Off ${formatDay(fields.date, { weekday: "long" })} (Time off)`;
  if (fields.kind === "evaluation") return staff.role === "admin" ? "Admin" : "Manager";
  if (!staff.subjects.some((subject) => subject.id === fields.subjectId)) {
    return `Not set up for ${subjectName}`;
  }
  if (staff.role === "admin") return `Teaches ${subjectName} · no set availability`;
  const free = getFreeSlots(bookings, staff.id, fields.date, SESSION_MINUTES.regular, editingId);
  return free.length > 0
    ? `Teaches ${subjectName} · free from ${formatTime(free[0].start_time)}`
    : `Teaches ${subjectName} · no free time that day`;
}

type TimeFieldsProps = { form: BookingFormState };

function TimeFields({ form }: TimeFieldsProps): ReactNode {
  const { fields, slots } = form;
  const staffName = form.staffOptions.find((staff) => staff.id === fields.userId)?.name ?? "";
  const showsSlots = slots.length > 0 && !fields.isCustomTime;
  const error = getError(form, "time");

  if (showsSlots) {
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[14px] leading-5 font-semibold">
          Free times · {getFirstName(staffName)}, {formatDay(fields.date, { weekday: "short", month: "short", day: "numeric" })}
        </legend>
        <div className="flex flex-wrap gap-2">
          {slots.map((slot) => {
            const isPicked = slot.start_time === fields.startTime && !fields.isCustomTime;
            return (
              <button
                key={`${slot.availability_id}-${slot.start_time}`}
                type="button"
                aria-pressed={isPicked}
                onClick={() => form.pickSlot(slot)}
                className={cn(
                  "h-11 cursor-pointer rounded-full border px-4 text-[14px] font-medium tabular-nums transition-colors duration-150",
                  isPicked
                    ? "border-(--tl-primary) bg-(--tl-primary) text-(--tl-on-primary)"
                    : "border-(--tl-border) bg-(--tl-surface) hover:bg-(--tl-tint)",
                )}
              >
                {formatTime(slot.start_time)}
              </button>
            );
          })}
        </div>
        <p className="px-1 text-[13px] text-(--tl-muted)">
          {SESSION_MINUTES[fields.kind]} min each, inside {getFirstName(staffName)}’s availability.{" "}
          <TextLink onClick={() => form.set({ isCustomTime: true })} className="text-[13px]">
            Other time
          </TextLink>
        </p>
        {error && <p className="px-1 text-[13px] font-medium text-(--tl-danger)">{error}</p>}
      </fieldset>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Start"
          type="time"
          step={900}
          value={fields.startTime.slice(0, 5)}
          onChange={(event) => form.setStart(event.target.value ? `${event.target.value}:00` : "")}
          error={error}
        />
        <TextField
          label="End"
          type="time"
          step={900}
          value={fields.endTime.slice(0, 5)}
          onChange={(event) =>
            form.set({ endTime: event.target.value ? `${event.target.value}:00` : "" })
          }
        />
      </div>
      <p className="px-1 text-[13px] text-(--tl-muted)">
        End fills in from the {SESSION_MINUTES[fields.kind]}-minute length in Settings.{" "}
        {slots.length > 0 && (
          <TextLink onClick={() => form.set({ isCustomTime: false })} className="text-[13px]">
            Show free times
          </TextLink>
        )}
      </p>
    </div>
  );
}

type BookingFormProps = {
  start: FormStart;
  editing: BookingDetail | null;
  bookings: BookingDetail[];
  onClose: () => void;
  onSaved: (body: BookingCreate) => void;
};

export default function BookingForm({
  start,
  editing,
  bookings,
  onClose,
  onSaved,
}: BookingFormProps): ReactNode {
  const form = useBookingForm({ start, editing, bookings, onSaved });
  const { fields, child } = form;
  const isChange = editing !== null;
  const editingId = editing?.id ?? null;
  const hasWarnings = form.warnings.length > 0;
  const staffName = form.staffOptions.find((staff) => staff.id === fields.userId)?.name;
  const homes = (child?.homes ?? []).filter((home) => !home.archived);

  let submitLabel = isChange ? "Save changes" : "Book";
  if (hasWarnings) submitLabel = isChange ? "Save anyway" : "Book anyway";
  if (form.isSaving) submitLabel = isChange ? "Saving…" : "Booking…";

  const request = isChange
    ? `PUT /api/bookings/${editing.id}`
    : "POST /api/bookings";
  // PUT takes neither the Child nor the booking Guardian.
  const requestBody = isChange
    ? Object.fromEntries(
        Object.entries(form.body).filter(
          ([key]) => key !== "child_id" && key !== "booked_by_guardian_id",
        ),
      )
    : form.body;

  return (
    <DetailOverlay
      isOpen
      onClose={onClose}
      title={isChange ? "Change booking" : "New booking"}
      backLabel={isChange ? "Booking" : "Bookings"}
      phoneMode="page"
      header={
        <h2 className="kit-display text-[28px] leading-9 font-light">
          {isChange ? "Change booking" : "New booking"}
        </h2>
      }
      footer={
        <>
          <Button
            variant="primary"
            isFullWidth
            className="@md:flex-1"
            isLoading={form.isSaving}
            onClick={form.submit}
          >
            {submitLabel}
          </Button>
          <Button isFullWidth className="@md:flex-1" onClick={onClose} disabled={form.isSaving}>
            Discard
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 pt-2">
        {isChange ? (
          <div className="flex flex-wrap items-center gap-2 rounded-[18px] bg-(--tl-surface-sunk) px-4 py-3">
            <span className="flex-1 font-semibold">{editing.child.name}</span>
            <KindBadge kind={KIND_LABEL[editing.kind]} />
          </div>
        ) : (
          <>
            <SegmentedControl
              label="Kind"
              isFullWidth
              activeId={fields.kind}
              onChange={(id) => form.setKind(id === "evaluation" ? "evaluation" : "regular")}
              items={[
                { id: "regular", label: "Tutoring" },
                { id: "evaluation", label: "Evaluation" },
              ]}
            />
            <Combobox
              label="Child"
              placeholder="Search Children"
              value={fields.childId}
              onChange={form.setChild}
              error={getError(form, "child")}
              help={
                fields.kind === "evaluation"
                  ? "Only Children not yet Evaluated, with no Evaluation booked."
                  : undefined
              }
              options={form.childOptions.map((item) => ({
                value: item.id,
                label: item.name,
                description:
                  fields.kind === "evaluation"
                    ? `${formatGrade(item.grade_level)} · waiting ${pluralize(getDaysSince(item.created_at), "day", "days")}`
                    : `${item.guardians.map((guardian) => guardian.name).join(", ")}`,
              }))}
            />
          </>
        )}

        {fields.kind === "regular" && (
          <SelectField
            label="Subject"
            value={fields.subjectId ?? ""}
            onChange={(event) => form.set({ subjectId: event.target.value || null, userId: isChange ? fields.userId : null })}
            error={getError(form, "subject")}
            disabled={!child || child.levels.length === 0}
            placeholder={child ? "Pick a Subject" : "Pick a Child first"}
            help={child && child.levels.length === 0 ? "This Child has no Subject levels yet. Set them on the Child first." : undefined}
            options={[
              ...(child?.levels ?? []).map((level) => ({
                value: level.subject_id,
                label: `${level.name} · ${formatGrade(level.level)}`,
              })),
            ]}
          />
        )}

        <TextField
          label="Date"
          type="date"
          min={TODAY}
          value={fields.date}
          onChange={(event) => form.set({ date: event.target.value })}
          error={getError(form, "date")}
        />

        <Combobox
          label="Staff"
          placeholder={fields.kind === "evaluation" ? "Pick an Admin or Manager" : "Search Staff"}
          value={fields.userId}
          onChange={form.setStaff}
          error={getError(form, "staff")}
          help={
            isChange && fields.userId === null && editing.staff.id
              ? `${editing.staff.name} can’t take this booking any more. Pick someone else.`
              : undefined
          }
          options={form.staffOptions.map((staff) => ({
            value: staff.id,
            label: staff.name,
            description: describeStaff(staff, form, bookings, editingId),
            hasAvatar: true,
          }))}
        />

        {form.swapOptions.length > 0 && (
          <div className="rounded-[18px] bg-(--tl-yellow-tint) p-4 text-(--tl-yellow-ink)">
            <p className="flex items-center gap-2 text-[14px] font-semibold">
              <Plane aria-hidden className="size-4" />
              {staffName
                ? `${getFirstName(staffName)} is off. Free at ${formatTime(fields.startTime)}:`
                : `Free at ${formatTime(fields.startTime)}:`}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {form.swapOptions.map((staff) => (
                <Button key={staff.id} variant="outline" onClick={() => form.setStaff(staff.id)}>
                  {staff.name}
                </Button>
              ))}
            </div>
          </div>
        )}

        <TimeFields form={form} />

        <RadioCards
          legend="Location"
          value={fields.location === "home" ? (fields.homeId ?? "") : "in_office"}
          onChange={(value) =>
            value === "in_office"
              ? form.set({ location: "in_office", homeId: null })
              : form.set({ location: "home", homeId: value })
          }
          options={[
            ...homes.map((home) => ({
              value: home.id,
              label: home.label ? `${home.label} home` : "Home",
              description: home.address,
            })),
            { value: "in_office", label: "In office" },
          ]}
        />

        <TextAreaField
          label="Notes"
          rows={3}
          value={fields.notes}
          onChange={(event) => form.set({ notes: event.target.value })}
          help="For this booking only. Notes for tutors stay on the Child."
        />

        {form.error && (
          <div role="alert" className="flex gap-3 rounded-[18px] bg-(--tl-danger-tint) p-4 text-(--tl-danger)">
            <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
            <p className="text-[14px] leading-6 font-medium">{form.error}</p>
          </div>
        )}
        {hasWarnings && (
          <div role="alert" className="rounded-[18px] border border-(--tl-warning)/30 bg-(--tl-warning-tint) p-4 text-(--tl-warning)">
            <p className="flex items-center gap-2 text-[14px] font-semibold">
              <TriangleAlert aria-hidden className="size-5" />
              Check before you {isChange ? "save" : "book"}
            </p>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-6 text-[14px] leading-6">
              {form.warnings.map((warning) => (
                <li key={warning.code}>{warning.message}</li>
              ))}
            </ul>
            <p className="mt-2 text-[13px]">
              {isChange ? "Save anyway" : "Book anyway"} if that’s intended.
            </p>
          </div>
        )}
        <p aria-live="polite" className="sr-only">
          {form.isSaving ? submitLabel : ""}
        </p>

        <details className="rounded-[14px] border border-dashed border-(--tl-border) px-3 py-2 text-[12px] text-(--tl-muted)">
          <summary className="cursor-pointer font-semibold">
            <Badge tone="neutral">Prototype</Badge> Request this form sends
          </summary>
          <pre className="mt-2 overflow-x-auto font-mono text-[11px] leading-4 whitespace-pre-wrap">
            {request}
            {"\n"}
            {JSON.stringify(requestBody, null, 2)}
          </pre>
        </details>
      </div>
    </DetailOverlay>
  );
}
