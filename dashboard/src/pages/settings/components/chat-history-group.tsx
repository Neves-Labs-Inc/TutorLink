// Chat history: keep chats forever, or delete those older than a period;
// and the daily clean-up time, shown in office time though stored in UTC.
import { useState } from "react";
import type { ReactNode } from "react";
import { RadioCards } from "@/components/kit/components/choices";
import { SectionCard } from "@/components/kit/components/section-card";
import Select from "@/components/kit/components/select";
import {
  DurationField,
  FieldFrame,
} from "@/components/kit/components/settings-form";
import { BUSINESS_TIME_ZONE } from "@/components/kit/format";
import { RETENTION_UNITS } from "@/lib/settings/duration-units";
import {
  formatHour,
  getZoneAbbreviation,
  HOUR_OPTIONS,
  utcToZoneHour,
  zoneToUtcHour,
} from "@/lib/settings/office-time";
import {
  BUSINESS_TIMEZONE_KEY,
  PURGE_HOUR_KEY,
  RETENTION_KEY,
} from "@/lib/settings/settings-groups";
import type { SettingsForm } from "@/pages/settings/hooks/use-settings-form";

const KEEP_FOREVER = "0";
const DEFAULT_RETENTION_DAYS = "365";
const FOREVER = "forever";
const LIMITED = "limited";

type ChatHistoryGroupProps = { form: SettingsForm };

export default function ChatHistoryGroup({
  form,
}: ChatHistoryGroupProps): ReactNode {
  const retention = form.bind(RETENTION_KEY);
  const purge = form.bind(PURGE_HOUR_KEY);
  const zone = form.valueOf(BUSINESS_TIMEZONE_KEY) || BUSINESS_TIME_ZONE;
  const now = new Date();
  const zoneName = getZoneAbbreviation(zone, now);
  // Typing 0 on the way to another number must not swap the field away.
  const [isEditingAmount, setIsEditingAmount] = useState(false);
  const isForever = retention.value === KEEP_FOREVER && !isEditingAmount;
  const purgeHour = utcToZoneHour(Number(purge.value), zone, now);

  function handleModeChange(mode: string): void {
    const saved = form.savedValueOf(RETENTION_KEY);
    const fallback = saved === KEEP_FOREVER ? DEFAULT_RETENTION_DAYS : saved;
    retention.onChange(mode === FOREVER ? KEEP_FOREVER : fallback);
  }

  return (
    <SectionCard
      id="chat-history"
      title="Chat history"
      description="How long WhatsApp chats are kept before they’re deleted for good."
    >
      <RadioCards
        legend="Keep chats"
        isHorizontal
        value={isForever ? FOREVER : LIMITED}
        onChange={handleModeChange}
        options={[
          {
            value: LIMITED,
            label: "For a set time",
            description: "Older messages are deleted every day.",
          },
          {
            value: FOREVER,
            label: "Forever",
            description: "Nothing is ever deleted.",
          },
        ]}
      />
      {isForever ? (
        <p className="text-[14px] leading-5 text-(--tl-muted)">
          Clean-up still runs daily at {formatHour(purgeHour)} {zoneName} but
          finds nothing to delete.
        </p>
      ) : (
        <div className="kit-rise grid gap-6 @3xl:grid-cols-2">
          <div
            onFocus={() => setIsEditingAmount(true)}
            onBlur={() => {
              setIsEditingAmount(false);
              form.touch(RETENTION_KEY);
            }}
          >
            <DurationField
              label="Delete messages older than"
              help="A chat with no messages left is deleted too. This can’t be undone."
              units={RETENTION_UNITS}
              {...retention}
            />
          </div>
          <FieldFrame
            label="Daily clean-up time"
            help={`Office time (${zoneName}). Stored in UTC, so it shifts by an hour when daylight saving changes.`}
            isChanged={purge.isChanged}
            error={purge.error}
          >
            {({ controlId, describedBy }) => (
              <Select
                variant="field"
                id={controlId}
                aria-describedby={describedBy}
                label="Daily clean-up time"
                options={HOUR_OPTIONS}
                value={String(purgeHour)}
                onValueChange={(hour) =>
                  purge.onChange(String(zoneToUtcHour(Number(hour), zone, now)))
                }
                className="max-w-[320px]"
              />
            )}
          </FieldFrame>
        </div>
      )}
    </SectionCard>
  );
}
