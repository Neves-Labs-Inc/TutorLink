// Booking reminders: the office-wide switch, the weekly day and time,
// and a status line that says what will actually happen.
import type { ReactNode } from "react";
import { BellOff, CalendarClock, CircleAlert, MessageCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SwitchField } from "@/components/kit/components/choices";
import { TextLink } from "@/components/kit/components/button";
import { Badge } from "@/components/kit/components/badges";
import { cn } from "@/components/kit/tokens";
import SectionCard from "@/pages/prototype/settings/components/section-card";
import { bindField } from "@/pages/prototype/settings/lib/bind-field";
import FieldFrame, {
  SelectControl,
} from "@/pages/prototype/settings/components/field-frame";
import {
  formatHour,
  getShortZoneName,
  HOUR_OPTIONS,
  WEEKDAY_OPTIONS,
  WEEKDAYS,
} from "@/pages/prototype/settings/lib/time";
import type { SettingsApi } from "@/pages/prototype/settings/hooks/use-settings";

type RemindersSectionProps = {
  settings: SettingsApi;
  onOpenChats: () => void;
};

// The prototype's today, Tuesday 13 October 2026 (ISO weekday 2).
const TODAY_WEEKDAY = 2;
const TODAY_DATE = 13;
const DAYS_PER_WEEK = 7;

function getNextSend(weekday: number, hour: number): string {
  const daysAhead = (weekday - TODAY_WEEKDAY + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  const label = daysAhead === 0 ? "Today" : WEEKDAYS[weekday - 1];
  return `${label}, October ${TODAY_DATE + daysAhead}, at ${formatHour(hour)}`;
}

type Status = {
  tone: "success" | "neutral" | "warning";
  icon: LucideIcon;
  title: string;
  body: string;
};

export default function RemindersSection({
  settings,
  onOpenChats,
}: RemindersSectionProps): ReactNode {
  const enabled = bindField(settings, "reminders_enabled");
  const weekday = bindField(settings, "reminder_weekday");
  const hour = bindField(settings, "reminder_hour");
  const isOn = enabled.value === "true";
  const isNotSetUp = settings.page.reminders_paused;
  const zone = getShortZoneName(settings.valueOf("business_timezone"));

  let status: Status;
  if (isNotSetUp) {
    status = {
      tone: "warning",
      icon: CircleAlert,
      title: "Not set up yet",
      body: "WhatsApp hasn't approved the reminder message, so nothing is sent whatever this switch says. Your developer finishes setup once it's approved.",
    };
  } else if (isOn) {
    status = {
      tone: "success",
      icon: CalendarClock,
      title: `Next send: ${getNextSend(Number(weekday.value), Number(hour.value))} ${zone}`,
      body: "Only to Guardians with Reminders on and no session booked for the coming week.",
    };
  } else {
    status = {
      tone: "neutral",
      icon: BellOff,
      title: "Paused for everyone",
      body: "No Guardian gets a reminder until you turn this back on. The bot still asks new Guardians whether they want them.",
    };
  }

  return (
    <SectionCard
      id="reminders"
      title="Booking reminders"
      description="A weekly WhatsApp message to Guardians with nothing booked for the coming week."
      badge={
        isNotSetUp ? (
          <Badge tone="warning" hasDot>
            Not set up
          </Badge>
        ) : (
          <Badge tone={isOn ? "success" : "neutral"} hasDot>
            {isOn ? "On" : "Off"}
          </Badge>
        )
      }
    >
      <StatusLine status={status} />
      <div className="flex flex-col gap-1">
        <SwitchField
          label="Send Booking reminders"
          description="Guardians who chose Reminders off never get one, either way."
          isOn={isOn}
          onChange={(next) => enabled.onChange(String(next))}
        />
      </div>
      <div className="grid gap-6 @2xl:grid-cols-2">
        <FieldFrame
          label="Day"
          isChanged={weekday.isChanged}
          help="Every week on this day."
        >
          {({ controlId, describedBy }) => (
            <SelectControl
              id={controlId}
              aria-describedby={describedBy}
              options={WEEKDAY_OPTIONS}
              label="Reminder day"
              value={weekday.value}
              disabled={!isOn}
              onChange={(event) => weekday.onChange(event.target.value)}
            />
          )}
        </FieldFrame>
        <FieldFrame
          label="Time"
          isChanged={hour.isChanged}
          help={`Office time (${zone}).`}
        >
          {({ controlId, describedBy }) => (
            <SelectControl
              id={controlId}
              aria-describedby={describedBy}
              options={HOUR_OPTIONS}
              label="Reminder time"
              value={hour.value}
              disabled={!isOn}
              onChange={(event) => hour.onChange(event.target.value)}
            />
          )}
        </FieldFrame>
      </div>
      <p className="flex items-center gap-2 text-[14px] text-(--tl-muted)">
        <MessageCircle aria-hidden className="size-4 shrink-0" />
        <span>
          Who gets one, and who got last week's:{" "}
          <TextLink onClick={onOpenChats}>Chats ▸ Reminders</TextLink>
        </span>
      </p>
    </SectionCard>
  );
}

const STATUS_TONES: Record<Status["tone"], string> = {
  success: "bg-(--tl-success-tint) text-(--tl-success)",
  neutral: "bg-(--tl-neutral-tint) text-(--tl-neutral)",
  warning: "bg-(--tl-warning-tint) text-(--tl-warning)",
};

function StatusLine({ status }: { status: Status }): ReactNode {
  const Icon = status.icon;
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-[16px] bg-(--tl-surface-sunk) p-4"
    >
      <span
        className={cn(
          "inline-flex size-10 shrink-0 items-center justify-center rounded-full",
          STATUS_TONES[status.tone],
        )}
      >
        <Icon aria-hidden className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] leading-6 font-semibold">
          {status.title}
        </span>
        <span className="block text-[14px] leading-5 text-(--tl-muted)">
          {status.body}
        </span>
      </span>
    </div>
  );
}
