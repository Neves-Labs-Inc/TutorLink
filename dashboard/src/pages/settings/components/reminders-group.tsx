// Booking reminders: the office-wide switch, the weekly day and time, and
// a status well that says what will actually happen.
import type { ReactNode } from "react";
import {
  BellOff,
  CalendarClock,
  CircleAlert,
  MessageCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/kit/components/badges";
import { TextLink } from "@/components/kit/components/button";
import { SwitchField } from "@/components/kit/components/choices";
import { SectionCard } from "@/components/kit/components/section-card";
import Select from "@/components/kit/components/select";
import { FieldFrame } from "@/components/kit/components/settings-form";
import { BUSINESS_TIME_ZONE } from "@/components/kit/format";
import { cn, TONE_CLASSES } from "@/components/kit/tokens";
import type { Tone } from "@/components/kit/tokens";
import { useGuardedNavigate } from "@/hooks/use-leave-guard";
import {
  formatNextSend,
  getNextSend,
  getZoneAbbreviation,
  HOUR_OPTIONS,
  WEEKDAY_OPTIONS,
} from "@/lib/settings/office-time";
import { BUSINESS_TIMEZONE_KEY } from "@/lib/settings/settings-groups";
import type { SettingsForm } from "@/pages/settings/hooks/use-settings-form";

// The Chats area's Reminders tab.
const CHATS_REMINDERS_PATH = "/chats/reminders";

type Status = {
  tone: Extract<Tone, "success" | "neutral" | "warning">;
  icon: LucideIcon;
  title: string;
  body: string;
};

type RemindersGroupProps = { form: SettingsForm };

function getStatus(
  areRemindersPaused: boolean,
  isOn: boolean,
  nextSend: string,
  zoneName: string,
): Status {
  if (areRemindersPaused) {
    return {
      tone: "warning",
      icon: CircleAlert,
      title: "Not set up yet",
      body: "WhatsApp hasn’t approved the reminder message, so nothing is sent whatever this switch says. Your developer finishes setup once it’s approved.",
    };
  }
  if (isOn) {
    return {
      tone: "success",
      icon: CalendarClock,
      title: `Next send: ${nextSend} ${zoneName}`,
      body: "Only to Guardians with Reminders on and no session booked for the coming week.",
    };
  }
  return {
    tone: "neutral",
    icon: BellOff,
    title: "Paused for everyone",
    body: "No Guardian gets a reminder until you turn this back on. The bot still asks new Guardians whether they want them.",
  };
}

export default function RemindersGroup({
  form,
}: RemindersGroupProps): ReactNode {
  const navigate = useGuardedNavigate();
  const enabled = form.bind("reminders_enabled");
  const weekday = form.bind("reminder_weekday");
  const hour = form.bind("reminder_hour");
  const isOn = enabled.value === "true";
  const zone = form.valueOf(BUSINESS_TIMEZONE_KEY) || BUSINESS_TIME_ZONE;
  const now = new Date();
  const zoneName = getZoneAbbreviation(zone, now);
  const nextSend = formatNextSend(
    getNextSend(Number(weekday.value), Number(hour.value), zone, now),
  );
  const status = getStatus(form.areRemindersPaused, isOn, nextSend, zoneName);

  return (
    <SectionCard
      id="reminders"
      title="Booking reminders"
      description="A weekly WhatsApp message to Guardians with nothing booked for the coming week."
      badge={
        form.areRemindersPaused ? (
          <Badge tone="warning" icon={CircleAlert}>
            Not set up
          </Badge>
        ) : (
          <Badge tone={isOn ? "success" : "neutral"} hasDot>
            {isOn ? "On" : "Off"}
          </Badge>
        )
      }
    >
      <StatusWell status={status} />
      <SwitchField
        label="Send Booking reminders"
        description="Guardians who chose Reminders off never get one, either way."
        isOn={isOn}
        onChange={(next) => enabled.onChange(String(next))}
      />
      <div className="grid gap-6 @2xl:grid-cols-2">
        <FieldFrame
          label="Day"
          help="Every week on this day."
          isChanged={weekday.isChanged}
          error={weekday.error}
        >
          {({ controlId, describedBy }) => (
            <Select
              variant="field"
              id={controlId}
              aria-describedby={describedBy}
              label="Day"
              options={WEEKDAY_OPTIONS}
              value={weekday.value}
              disabled={!isOn}
              onValueChange={weekday.onChange}
              className="max-w-[320px]"
            />
          )}
        </FieldFrame>
        <FieldFrame
          label="Time"
          help={`Office time (${zoneName}).`}
          isChanged={hour.isChanged}
          error={hour.error}
        >
          {({ controlId, describedBy }) => (
            <Select
              variant="field"
              id={controlId}
              aria-describedby={describedBy}
              label="Time"
              options={HOUR_OPTIONS}
              value={hour.value}
              disabled={!isOn}
              onValueChange={hour.onChange}
              className="max-w-[320px]"
            />
          )}
        </FieldFrame>
      </div>
      <p className="flex items-center gap-2 text-[14px] leading-5 text-(--tl-muted)">
        <MessageCircle aria-hidden className="size-4 shrink-0" />
        <span>
          Who gets one, and who got last week’s:{" "}
          <TextLink onClick={() => navigate(CHATS_REMINDERS_PATH)}>
            Chats ▸ Reminders
          </TextLink>
        </span>
      </p>
    </SectionCard>
  );
}

type StatusWellProps = { status: Status };

function StatusWell({ status }: StatusWellProps): ReactNode {
  const Icon = status.icon;
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-[16px] bg-(--tl-surface-sunk) p-4"
    >
      <span
        className={cn(
          "inline-flex size-10 shrink-0 items-center justify-center rounded-full",
          TONE_CLASSES[status.tone],
        )}
      >
        <Icon aria-hidden className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] leading-6 font-semibold text-(--tl-ink)">
          {status.title}
        </span>
        <span className="block text-[14px] leading-5 text-(--tl-muted)">
          {status.body}
        </span>
      </span>
    </div>
  );
}
