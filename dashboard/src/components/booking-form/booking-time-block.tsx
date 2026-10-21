// When the session runs: the picked Staff member's free times as chips,
// or Start and End fields ("Other time", Evaluations, no free time).
// Switching between them moves focus to the first chip or to Start.
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { formatDay } from "@/components/kit/format";
import { TextLink } from "@/components/kit/components/button";
import { TextField } from "@/components/kit/components/fields";
import FreeTimeChips, {
  FreeTimesLoading,
} from "@/components/booking-form/free-time-chips";
import type { BookingFormState } from "@/hooks/use-booking-form";
import { getFirstName } from "@/lib/bookings/booking-details";
import { getSlotKey } from "@/lib/bookings/booking-form";

const QUARTER_HOUR_SECONDS = 900;
const HELP = "px-1 text-[13px] leading-[18px] text-(--tl-muted)";

type FocusTarget = "start" | "chip" | null;

type BookingTimeBlockProps = { form: BookingFormState };

export default function BookingTimeBlock({
  form,
}: BookingTimeBlockProps): ReactNode {
  const { fields, freeTimes, chips, pickedStaff } = form;
  const containerRef = useRef<HTMLDivElement>(null);
  // Set by a switch; the next commit moves focus into the new block.
  const pendingFocusRef = useRef<FocusTarget>(null);
  useEffect(() => {
    const target = pendingFocusRef.current;
    if (target === null) return;
    pendingFocusRef.current = null;
    const selector = target === "chip" ? "button[aria-pressed]" : "input";
    containerRef.current?.querySelector<HTMLElement>(selector)?.focus();
  });

  const staffFirst = getFirstName(pickedStaff?.name ?? "");
  const day = fields.date
    ? formatDay(fields.date, { weekday: "short", month: "short", day: "numeric" })
    : "";
  const legend = `Free times · ${staffFirst}, ${day}`;
  const isWaitingForChips = !fields.isTypedTime && fields.kind === "regular";
  const pickedKey =
    !fields.isTypedTime && fields.availabilityId !== null
      ? getSlotKey({ availability_id: fields.availabilityId, start_time: fields.startTime })
      : null;

  function switchTo(isTyped: boolean): void {
    pendingFocusRef.current = isTyped ? "start" : "chip";
    form.setTypedTime(isTyped);
  }

  let block: ReactNode;
  if (isWaitingForChips && freeTimes.state === "loading") {
    block = <FreeTimesLoading legend={legend} />;
  } else if (isWaitingForChips && chips.length > 0) {
    block = (
      <FreeTimeChips
        legend={legend}
        slots={chips}
        pickedKey={pickedKey}
        onPick={form.pickSlot}
      >
        <p className={HELP}>
          {form.lengthMinutes} min each, inside {staffFirst}’s availability.{" "}
          <TextLink onClick={() => switchTo(true)} className="text-[13px]">
            Other time
          </TextLink>
        </p>
        {form.errors.time && (
          <p className="flex items-start gap-1.5 px-1 text-[13px] leading-[18px] font-medium text-(--tl-danger)">
            <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
            {form.errors.time}
          </p>
        )}
      </FreeTimeChips>
    );
  } else {
    block = (
      <TimeFields form={form} staffFirst={staffFirst} day={day} onShowChips={() => switchTo(false)} />
    );
  }

  return (
    <div ref={containerRef} data-field="time">
      {block}
    </div>
  );
}

type TimeFieldsProps = {
  form: BookingFormState;
  staffFirst: string;
  day: string;
  onShowChips: () => void;
};

function TimeFields({
  form,
  staffFirst,
  day,
  onShowChips,
}: TimeFieldsProps): ReactNode {
  const { fields, freeTimes, chips } = form;
  let help: ReactNode = (
    <p className={HELP}>
      End fills in from the {form.lengthMinutes}-minute session length.
      {chips.length > 0 && (
        <>
          {" "}
          <TextLink onClick={onShowChips} className="text-[13px]">
            Show free times
          </TextLink>
        </>
      )}
    </p>
  );
  if (fields.kind === "regular" && freeTimes.state === "error") {
    help = (
      <p className="px-1 text-[13px] leading-[18px] text-(--tl-warning)">
        Couldn’t load free times. Set a start and end time, or try again.{" "}
        <TextLink onClick={freeTimes.retry} className="text-[13px]">
          Try again
        </TextLink>
      </p>
    );
  } else if (fields.kind === "regular" && freeTimes.state === "ready" && chips.length === 0) {
    help = (
      <p className={HELP}>
        {staffFirst} has no free time on {day}. Set a start and end time.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Start"
          type="time"
          step={QUARTER_HOUR_SECONDS}
          value={fields.startTime.slice(0, 5)}
          onChange={(event) => form.setStart(event.target.value)}
          error={form.errors.time}
        />
        <TextField
          label="End"
          type="time"
          step={QUARTER_HOUR_SECONDS}
          value={fields.endTime.slice(0, 5)}
          onChange={(event) => form.setEnd(event.target.value)}
        />
      </div>
      {help}
    </div>
  );
}
