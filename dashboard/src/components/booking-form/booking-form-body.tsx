// The form's fields in the order of the job: who (Kind, Child, Subject),
// when (Date), with whom (Staff), what time, where, and notes. Change
// booking locks the Child and Kind (PUT refuses both).
import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { getTodayKey } from "@/components/kit/format";
import { KindBadge } from "@/components/kit/components/badges";
import { TextLink } from "@/components/kit/components/button";
import { RadioCards } from "@/components/kit/components/choices";
import { Combobox } from "@/components/kit/components/combobox";
import {
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/kit/components/fields";
import { SegmentedControl } from "@/components/kit/components/tabs";
import BookingFormAlert from "@/components/booking-form/booking-form-alert";
import BookingStaffField from "@/components/booking-form/booking-staff-field";
import BookingTimeBlock from "@/components/booking-form/booking-time-block";
import type { BookingFormState } from "@/hooks/use-booking-form";
import { NOTES_MAX_LENGTH } from "@/lib/booking-form/bookingForm";
import { gradeName } from "@/lib/grades/grades";

const IN_OFFICE = "in_office";
const CHILDREN_LOAD_FAILED =
  "Couldn’t load the Children list. Check your connection and try again.";
const KIND_ITEMS = [
  { id: "regular", label: "Tutoring" },
  { id: "evaluation", label: "Evaluation" },
];

type BookingFormBodyProps = { form: BookingFormState };

export default function BookingFormBody({
  form,
}: BookingFormBodyProps): ReactNode {
  const { fields, child } = form;
  const levels = (child?.levels ?? []).filter((level) => !level.archived);
  const homes = (child?.homes ?? []).filter((home) => !home.archived);
  const isRegular = fields.kind === "regular";
  let subjectHelp: string | undefined;
  if (child && levels.length === 0) {
    subjectHelp = "This Child has no Subject levels yet. Set them on the Child first.";
  }

  return (
    <div className="flex flex-col gap-4 pt-2">
      {form.isChange && form.booking ? (
        <div className="rounded-[16px] bg-(--tl-surface-sunk) px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[15px] leading-6 font-semibold">
              {form.booking.child.name}
            </span>
            <KindBadge kind={form.booking.kind} />
          </div>
          <p className="text-[13px] text-(--tl-muted)">Child and kind stay as booked.</p>
        </div>
      ) : (
        <>
          <SegmentedControl
            label="Kind"
            isFullWidth
            activeId={fields.kind}
            onChange={(id) => form.setKind(id === "evaluation" ? "evaluation" : "regular")}
            items={KIND_ITEMS}
          />
          <ChildField form={form} />
        </>
      )}

      {isRegular && (
        <div data-field="subject" className="kit-rise">
          <SelectField
            label="Subject"
            value={fields.subjectId ?? ""}
            onValueChange={form.setSubject}
            error={form.errors.subject}
            disabled={!child || levels.length === 0}
            placeholder={child ? "Pick a Subject" : "Pick a Child first"}
            help={subjectHelp}
            options={levels.map((level) => ({
              value: level.subject_id,
              label: `${level.name} · ${gradeName(level.level)}`,
            }))}
          />
        </div>
      )}

      <div data-field="date">
        <TextField
          label="Date"
          type="date"
          min={getTodayKey()}
          value={fields.date}
          onChange={(event) => form.setDate(event.target.value)}
          error={form.errors.date}
        />
      </div>

      <BookingStaffField form={form} />
      <BookingTimeBlock form={form} />

      <div data-field="home" className="flex flex-col gap-1">
        <RadioCards
          legend="Location"
          value={fields.location === "home" ? (fields.homeId ?? "") : IN_OFFICE}
          onChange={form.setPlace}
          options={[
            ...homes.map((home) => ({
              value: home.id,
              label: home.label ? `${home.label} home` : "Home",
              description: home.address,
            })),
            { value: IN_OFFICE, label: "In office" },
          ]}
        />
        {form.errors.home && (
          <p className="flex items-start gap-1.5 px-1 text-[13px] leading-[18px] font-medium text-(--tl-danger)">
            <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
            {form.errors.home}
          </p>
        )}
      </div>

      <TextAreaField
        label="Notes"
        rows={3}
        maxLength={NOTES_MAX_LENGTH}
        value={fields.notes}
        onChange={(event) => form.setNotes(event.target.value)}
        help="For this booking only. Notes for tutors stay on the Child."
      />

      <BookingFormAlert form={form} />
    </div>
  );
}

type ChildFieldProps = { form: BookingFormState };

function ChildField({ form }: ChildFieldProps): ReactNode {
  const { fields, children } = form;
  const isEvaluation = fields.kind === "evaluation";
  return (
    <div data-field="child" className="flex flex-col gap-1">
      <Combobox
        label="Child"
        isRequired
        placeholder="Search Children"
        value={fields.childId}
        onChange={form.setChild}
        isDisabled={children.isLoading}
        error={form.errors.child ?? (children.isError ? CHILDREN_LOAD_FAILED : undefined)}
        help={isEvaluation ? "Only Children not yet Evaluated, with no Evaluation booked." : undefined}
        emptyText={
          isEvaluation ? "No Children are waiting for an Evaluation." : "No Evaluated Children match."
        }
        options={children.items.map((child) => ({
          value: child.id,
          label: child.name,
          description: child.description,
        }))}
      />
      {children.isError && (
        <TextLink onClick={children.retry} className="self-start px-1 text-[13px]">
          Try again
        </TextLink>
      )}
    </div>
  );
}
