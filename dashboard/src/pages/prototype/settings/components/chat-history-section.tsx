// Chat history: keep forever, or delete chats older than a period; and
// the daily clean-up time, shown in office time though stored in UTC.
import type { ReactNode } from "react";
import { RadioCards } from "@/components/kit/components/choices";
import SectionCard from "@/pages/prototype/settings/components/section-card";
import { bindField } from "@/pages/prototype/settings/lib/bind-field";
import FieldFrame, {
  SelectControl,
} from "@/pages/prototype/settings/components/field-frame";
import { DurationField } from "@/pages/prototype/settings/components/number-fields";
import PrototypeNote from "@/pages/prototype/settings/components/prototype-note";
import {
  formatHour,
  getShortZoneName,
  HOUR_OPTIONS,
  utcToZoneHour,
  zoneToUtcHour,
} from "@/pages/prototype/settings/lib/time";
import { RETENTION_UNITS } from "@/pages/prototype/settings/lib/units";
import type { SettingsApi } from "@/pages/prototype/settings/hooks/use-settings";

const KEEP_FOREVER = "0";
const DEFAULT_RETENTION_DAYS = "365";

type ChatHistorySectionProps = { settings: SettingsApi };

export default function ChatHistorySection({
  settings,
}: ChatHistorySectionProps): ReactNode {
  const retention = bindField(settings, "chat_retention_days");
  const purge = bindField(settings, "retention_purge_hour_utc");
  const zone = settings.valueOf("business_timezone");
  const zoneName = getShortZoneName(zone);
  const isForever = retention.value === KEEP_FOREVER;
  const purgeLocalHour = utcToZoneHour(Number(purge.value), zone);

  function handleModeChange(mode: string): void {
    const saved = settings.savedValueOf("chat_retention_days");
    const fallback = saved === KEEP_FOREVER ? DEFAULT_RETENTION_DAYS : saved;
    retention.onChange(mode === "forever" ? KEEP_FOREVER : fallback);
  }

  return (
    <SectionCard
      id="chat-history"
      title="Chat history"
      description="How long WhatsApp chats are kept before they're deleted for good."
    >
      <RadioCards
        legend="Keep chats"
        isHorizontal
        value={isForever ? "forever" : "limited"}
        onChange={handleModeChange}
        options={[
          {
            value: "limited",
            label: "For a set time",
            description: "Older messages are deleted every day.",
          },
          {
            value: "forever",
            label: "Forever",
            description: "Nothing is ever deleted.",
          },
        ]}
      />
      {!isForever && (
        <div className="grid gap-6 @3xl:grid-cols-2">
          <DurationField
            label="Delete messages older than"
            help="A chat with no messages left is deleted too. This can't be undone."
            units={RETENTION_UNITS}
            {...retention}
          />
          <FieldFrame
            label="Daily clean-up time"
            help={`Office time (${zoneName}), when chats are quiet.`}
            isChanged={purge.isChanged}
            note={
              <PrototypeNote note={`Stored as an hour in UTC (retention_purge_hour_utc = ${purge.value}). Shown in office time, so it drifts by an hour when daylight saving changes. Store it in office time instead?`} />
            }
          >
            {({ controlId, describedBy }) => (
              <SelectControl
                id={controlId}
                aria-describedby={describedBy}
                options={HOUR_OPTIONS}
                label="Daily clean-up time"
                value={String(purgeLocalHour)}
                onChange={(event) =>
                  purge.onChange(String(zoneToUtcHour(Number(event.target.value), zone)))
                }
                className="max-w-[320px]"
              />
            )}
          </FieldFrame>
        </div>
      )}
      {isForever && (
        <p className="text-[14px] leading-5 text-(--tl-muted)">
          Clean-up still runs daily at {formatHour(purgeLocalHour)} {zoneName}{" "}
          but finds nothing to delete.
        </p>
      )}
    </SectionCard>
  );
}
