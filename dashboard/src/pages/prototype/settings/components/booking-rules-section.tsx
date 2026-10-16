// Booking rules: the six scheduling keys, as durations and a count.
import type { ReactNode } from "react";
import SectionCard from "@/pages/prototype/settings/components/section-card";
import { bindField } from "@/pages/prototype/settings/lib/bind-field";
import {
  DurationField,
  StepperField,
} from "@/pages/prototype/settings/components/number-fields";
import PrototypeNote from "@/pages/prototype/settings/components/prototype-note";
import {
  DAYS_UNITS,
  formatDuration,
  HOURS_UNITS,
  MINUTES_UNITS,
} from "@/pages/prototype/settings/lib/units";
import type { SettingsApi } from "@/pages/prototype/settings/hooks/use-settings";

type BookingRulesSectionProps = { settings: SettingsApi };

export default function BookingRulesSection({
  settings,
}: BookingRulesSectionProps): ReactNode {
  const length = bindField(settings, "session_length_minutes");
  const gap = bindField(settings, "session_gap_minutes");
  const lookahead = bindField(settings, "booking_lookahead_days");
  const lead = bindField(settings, "min_booking_lead_hours");
  const cutoff = bindField(settings, "cancellation_cutoff_hours");
  const slots = bindField(settings, "max_slots_offered");
  const leadHours = Number(lead.value);

  return (
    <SectionCard
      id="booking-rules"
      title="Booking rules"
      description="What the bot offers Guardians, and what it lets them change. Staff can still book anything by hand."
    >
      <div className="grid gap-6 @3xl:grid-cols-2">
        <DurationField
          label="Session length"
          help="How long each Booking lasts. The bot offers times on this grid."
          units={MINUTES_UNITS}
          {...length}
        />
        <DurationField
          label="Break between sessions"
          help="Kept free between one Tutor's Bookings, for travel. 0 means back to back."
          units={MINUTES_UNITS}
          {...gap}
        />
        <DurationField
          label="How far ahead Guardians can book"
          help={`The bot offers times up to ${formatDuration(Number(lookahead.value) || 0, DAYS_UNITS)} from today.`}
          units={DAYS_UNITS}
          {...lookahead}
        />
        <DurationField
          label="Minimum notice to book"
          help={
            leadHours === 0
              ? "0 means any time that hasn't started yet."
              : `The bot won't offer a time starting in the next ${formatDuration(leadHours, HOURS_UNITS)}.`
          }
          units={HOURS_UNITS}
          {...lead}
        />
        <DurationField
          label="Last chance to cancel or reschedule"
          help="How long before a Booking starts a Guardian can still cancel or reschedule it through the bot. After that, they have to message the office."
          note={
            <PrototypeNote note="API gap: cancellation_cutoff_hours has no bounds in settings_service (a negative value is accepted). The prototype refuses below 0." />
          }
          units={HOURS_UNITS}
          {...cutoff}
        />
        <StepperField
          label="Times offered at once"
          help="How many times the bot lists in one message when a Guardian asks to book."
          min={1}
          suffix="times"
          {...slots}
        />
      </div>
    </SectionCard>
  );
}
