// Booking rules: the six keys that shape what the bot offers Guardians.
// Each rule has a hint under it and a "?" saying what the bot does with it.
import type { ReactNode } from "react";
import { InfoTip } from "@/components/kit/components/info-tip";
import { SectionCard } from "@/components/kit/components/section-card";
import {
  DurationField,
  StepperField,
} from "@/components/kit/components/settings-form";
import {
  DAYS_UNITS,
  formatDuration,
  HOURS_UNITS,
  MINUTES_UNITS,
} from "@/components/kit/lib/units";
import FieldGrid from "@/pages/settings/components/field-grid";
import type { SettingsForm } from "@/pages/settings/hooks/use-settings-form";

type BookingRulesGroupProps = { form: SettingsForm };

function getAmount(value: string): number {
  return Number(value) || 0;
}

export default function BookingRulesGroup({
  form,
}: BookingRulesGroupProps): ReactNode {
  const lookahead = form.bind("booking_lookahead_days");
  const lead = form.bind("min_booking_lead_hours");
  const leadHours = getAmount(lead.value);

  return (
    <SectionCard
      id="booking-rules"
      title="Booking rules"
      description="What the bot offers Guardians, and what it lets them change. Staff can still book anything by hand."
    >
      <FieldGrid>
        <div onBlur={() => form.touch("session_length_minutes")}>
          <DurationField
            label="Session length"
            help="How long each Booking lasts. The bot offers times on this grid."
            units={MINUTES_UNITS}
            trailing={
              <InfoTip label="About Session length">
                The bot only offers start times that fit this length, one
                after another, inside each Tutor’s Availability.
              </InfoTip>
            }
            {...form.bind("session_length_minutes")}
          />
        </div>
        <div onBlur={() => form.touch("session_gap_minutes")}>
          <DurationField
            label="Break between sessions"
            help="Kept free between one Tutor’s Bookings, for travel. 0 means back to back."
            units={MINUTES_UNITS}
            trailing={
              <InfoTip label="About Break between sessions">
                The bot leaves this gap after each Booking before it offers
                that Tutor’s next time.
              </InfoTip>
            }
            {...form.bind("session_gap_minutes")}
          />
        </div>
        <div onBlur={() => form.touch("booking_lookahead_days")}>
          <DurationField
            label="How far ahead Guardians can book"
            help={`The bot offers times up to ${formatDuration(getAmount(lookahead.value), DAYS_UNITS)} from today.`}
            units={DAYS_UNITS}
            trailing={
              <InfoTip label="About How far ahead Guardians can book">
                Times further out than this never appear when a Guardian asks
                to book. Staff can still book any date.
              </InfoTip>
            }
            {...lookahead}
          />
        </div>
        <div onBlur={() => form.touch("min_booking_lead_hours")}>
          <DurationField
            label="Minimum notice to book"
            help={
              leadHours === 0
                ? "0 means any time that hasn’t started yet."
                : `The bot won’t offer a time starting in the next ${formatDuration(leadHours, HOURS_UNITS)}.`
            }
            units={HOURS_UNITS}
            trailing={
              <InfoTip label="About Minimum notice to book">
                Gives the office and the Tutor time to see a new Booking
                before it starts.
              </InfoTip>
            }
            {...lead}
          />
        </div>
        <div onBlur={() => form.touch("cancellation_cutoff_hours")}>
          <DurationField
            label="Last chance to cancel or reschedule"
            help="How long before a Booking starts a Guardian can still cancel or reschedule it through the bot. After that, they have to message the office."
            units={HOURS_UNITS}
            trailing={
              <InfoTip label="About Last chance to cancel or reschedule">
                After this point the bot sends the Guardian to the office
                instead of changing the Booking.
              </InfoTip>
            }
            {...form.bind("cancellation_cutoff_hours")}
          />
        </div>
        <div onBlur={() => form.touch("max_slots_offered")}>
          <StepperField
            label="Times offered at once"
            help="How many times the bot lists in one message when a Guardian asks to book."
            min={1}
            suffix="times"
            trailing={
              <InfoTip label="About Times offered at once">
                More times means more choice, but a longer WhatsApp message.
              </InfoTip>
            }
            {...form.bind("max_slots_offered")}
          />
        </div>
      </FieldGrid>
    </SectionCard>
  );
}
