// Request time off (Tutors, Managers: lands Pending) and Add time off
// (Admins, for anyone including themselves: takes effect straight
// away). A bottom sheet on phone, a centred card on desktop. An Admin's
// entry over live Bookings comes back as the API's 409 warning, which
// the sheet shows in place and asks to confirm.
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { CalendarX2 } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import { SwitchField } from "@/components/kit/components/choices";
import { Combobox } from "@/components/kit/components/combobox";
import { TextAreaField, TextField } from "@/components/kit/components/fields";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import { useToast } from "@/components/kit/overlays/use-toast";
import { getFirstName, ROLE_LABEL } from "@/pages/prototype/tutor-timeoff/lib/labels";
import { TODAY } from "@/pages/prototype/tutor-timeoff/lib/rules";
import type { WriteResult } from "@/pages/prototype/tutor-timeoff/hooks/use-area-store";
import type {
  ExceptionCreate,
  ExceptionRead,
  MeRead,
  StaffRead,
  TimeOffWarning,
} from "@/pages/prototype/tutor-timeoff/types/api";

const FORM_ID = "time-off-form";
const REASON_MAX_LENGTH = 500;
const DEFAULT_FROM = "13:00";
const DEFAULT_TO = "17:00";

export type FormMode = "request" | "add";

type Errors = Partial<Record<"person" | "first" | "last" | "to", string>>;

type TimeOffFormSheetProps = {
  isOpen: boolean;
  mode: FormMode;
  me: MeRead;
  staff: StaffRead[];
  onClose: () => void;
  onSubmit: (userId: string, body: ExceptionCreate) => Promise<WriteResult>;
  onCreated: (item: ExceptionRead) => void;
};

export default function TimeOffFormSheet({
  isOpen,
  mode,
  me,
  staff,
  onClose,
  onSubmit,
  onCreated,
}: TimeOffFormSheetProps): ReactNode {
  const isAdd = mode === "add";
  const [personId, setPersonId] = useState<string | null>(isAdd ? null : me.id);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [isPartDay, setIsPartDay] = useState(false);
  const [from, setFrom] = useState(DEFAULT_FROM);
  const [to, setTo] = useState(DEFAULT_TO);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [warnings, setWarnings] = useState<TimeOffWarning[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const { showToast } = useToast();
  const person = staff.find((item) => item.id === personId) ?? null;
  const personName = person && person.id !== me.id ? getFirstName(person.name) : "you";

  function reset(): void {
    setPersonId(isAdd ? null : me.id);
    setFirst("");
    setLast("");
    setIsPartDay(false);
    setReason("");
    setErrors({});
    setWarnings([]);
  }

  function handleClose(): void {
    reset();
    onClose();
  }

  function validate(): Errors {
    const found: Errors = {};
    if (!personId) found.person = "Pick who the time off is for.";
    if (first === "") {
      found.first = "Pick the first day off.";
    } else if (!isAdd && first < TODAY) {
      // An Admin may log time off that has passed; a requester may not.
      found.first = "That day has passed. Pick today or later.";
    }
    if (last !== "" && first !== "" && last < first) found.last = "The last day can’t be before the first.";
    if (isPartDay && to <= from) found.to = "Ends before it starts. Pick a later time.";
    return found;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0 || !personId) return;
    setIsSaving(true);
    const result = await onSubmit(personId, {
      start_date: first,
      end_date: last || first,
      start_time: isPartDay ? `${from}:00` : null,
      end_time: isPartDay ? `${to}:00` : null,
      reason: reason.trim() || null,
      // The second press, after the warning was shown, confirms it.
      confirm_warnings: warnings.map((warning) => warning.code),
    });
    setIsSaving(false);
    if (result.status === 409) {
      setWarnings(result.warnings);
      return;
    }
    if (!result.value) {
      showToast({ tone: "error", message: result.error ?? "Couldn’t save. Try again." });
      return;
    }
    let message = "Request sent. You’ll see here when an Admin decides.";
    if (isAdd) {
      message = `Time off added for ${personName}. It’s in effect now.`;
    } else if (result.value.clashing_bookings_count > 0) {
      message = "Request sent. If it’s approved, the office will sort out your sessions in those dates.";
    }
    showToast({ tone: "success", message });
    onCreated(result.value);
    reset();
  }

  const title = isAdd ? "Add time off" : "Request time off";
  const description = isAdd
    ? "Takes effect straight away, with no approval."
    : "An Admin approves or declines it. You’ll see the answer on Time off.";
  const submitLabel = warnings.length > 0 ? "Add anyway" : isAdd ? "Add time off" : "Send request";

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      description={description}
      footer={
        <>
          <Button onClick={handleClose} disabled={isSaving}>
            Not now
          </Button>
          <Button variant="primary" type="submit" form={FORM_ID} isLoading={isSaving}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
        {isAdd && (
          <Combobox
            label="For"
            placeholder="Search Staff"
            value={personId}
            onChange={(id) => {
              setPersonId(id);
              setWarnings([]);
            }}
            error={errors.person}
            options={staff.map((item) => ({
              value: item.id,
              label: item.id === me.id ? `${item.name} (you)` : item.name,
              description: ROLE_LABEL[item.role],
              hasAvatar: true,
            }))}
          />
        )}
        <div className="grid gap-5 @md:grid-cols-2">
          <TextField
            label="First day"
            type="date"
            required
            min={isAdd ? undefined : TODAY}
            value={first}
            onChange={(event) => {
              setFirst(event.target.value);
              setWarnings([]);
            }}
            error={errors.first}
          />
          <TextField
            label="Last day"
            type="date"
            min={first || TODAY}
            value={last}
            onChange={(event) => {
              setLast(event.target.value);
              setWarnings([]);
            }}
            help="Leave empty for one day."
            error={errors.last}
          />
        </div>
        <SwitchField
          label="Only part of the day"
          description="The same hours on each day."
          isOn={isPartDay}
          onChange={(isOn) => {
            setIsPartDay(isOn);
            setWarnings([]);
          }}
        />
        {isPartDay && (
          <div className="grid grid-cols-2 gap-5">
            <TextField label="From" type="time" value={from} onChange={(event) => setFrom(event.target.value)} />
            <TextField
              label="To"
              type="time"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              error={errors.to}
            />
          </div>
        )}
        <TextAreaField
          label="Reason"
          rows={3}
          maxLength={REASON_MAX_LENGTH}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          help={isAdd ? "Optional. The person sees it too." : "Optional. Admins see it with your request."}
        />
        {warnings.length > 0 && (
          <div role="alert" className="rounded-[18px] bg-(--tl-warning-tint) p-4 text-(--tl-warning)">
            <p className="flex items-center gap-2 text-[15px] font-semibold">
              <CalendarX2 aria-hidden className="size-[18px] shrink-0" />
              {warnings[0].message}
            </p>
            <p className="mt-1.5 text-[14px] leading-6">
              Adding it keeps those Bookings and puts them in To do › Bookings to change or keep.
              Press Add anyway to go ahead.
            </p>
          </div>
        )}
      </form>
    </BottomSheet>
  );
}
