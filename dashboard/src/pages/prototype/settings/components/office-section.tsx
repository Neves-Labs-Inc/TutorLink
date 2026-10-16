// Office: the phone number Staff call, the office's street address (new,
// not in the API yet), the country code for numbers typed
// without one, and the business time zone (locked once Bookings exist).
import { useState } from "react";
import type { ReactNode } from "react";
import { Lock, Phone } from "lucide-react";
import { Badge } from "@/pages/prototype/shell-kit/kit/components/badges";
import { cn } from "@/pages/prototype/shell-kit/kit/tokens";
import SectionCard from "@/pages/prototype/settings/components/section-card";
import { bindField } from "@/pages/prototype/settings/lib/bind-field";
import FieldFrame, {
  SelectControl,
} from "@/pages/prototype/settings/components/field-frame";
import { getControlClasses } from "@/pages/prototype/settings/lib/control-classes";
import PrototypeNote from "@/pages/prototype/settings/components/prototype-note";
import { formatPhone, toE164 } from "@/pages/prototype/settings/lib/rules";
import {
  getTimeZoneLabel,
  TIME_ZONES,
} from "@/pages/prototype/settings/lib/time";
import type { SettingsApi } from "@/pages/prototype/settings/hooks/use-settings";

const COUNTRY_CODES = [
  { value: "1", label: "+1 United States and Canada" },
  { value: "52", label: "+52 Mexico" },
  { value: "55", label: "+55 Brazil" },
  { value: "57", label: "+57 Colombia" },
  { value: "58", label: "+58 Venezuela" },
  { value: "34", label: "+34 Spain" },
];

type OfficeSectionProps = { settings: SettingsApi };

export default function OfficeSection({
  settings,
}: OfficeSectionProps): ReactNode {
  const phone = bindField(settings, "office_phone");
  const country = bindField(settings, "default_phone_country_code");
  const zone = bindField(settings, "business_timezone");
  const address = bindField(settings, "office_address");
  const isZoneLocked = settings.page.business_timezone_locked;
  const [typedPhone, setTypedPhone] = useState(() => formatPhone(phone.value));
  // Show what they typed, unless the value changed from outside (Discard).
  const shownPhone =
    toE164(typedPhone) === phone.value ? typedPhone : formatPhone(phone.value);
  const countryOptions = COUNTRY_CODES.some((option) => option.value === country.value)
    ? COUNTRY_CODES
    : [{ value: country.value, label: `+${country.value}` }, ...COUNTRY_CODES];
  const zoneOptions = TIME_ZONES.some((option) => option.value === zone.value)
    ? TIME_ZONES
    : [{ value: zone.value, label: zone.value }, ...TIME_ZONES];

  function handlePhoneChange(next: string): void {
    setTypedPhone(next);
    phone.onChange(toE164(next));
  }

  return (
    <SectionCard
      id="office"
      title="Office"
      description="Contact details and the clock everything runs on."
    >
      <div className="grid gap-6 @3xl:grid-cols-2">
        <FieldFrame
          label="Office phone"
          help={
            phone.error
              ? undefined
              : "Tutors see this as the number to call the office. Leave it empty to hide it."
          }
          error={phone.error}
          isChanged={phone.isChanged}
        >
          {({ controlId, describedBy }) => (
            <div className="relative max-w-[320px]">
              <Phone
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-(--tl-muted)"
              />
              <input
                id={controlId}
                type="tel"
                autoComplete="off"
                placeholder="+1 305 555 0142"
                value={shownPhone}
                aria-describedby={describedBy}
                aria-invalid={phone.error ? true : undefined}
                onChange={(event) => handlePhoneChange(event.target.value)}
                className={cn(getControlClasses(Boolean(phone.error)), "w-full pr-4 pl-11")}
              />
            </div>
          )}
        </FieldFrame>
        <FieldFrame
          label="Office address"
          help="Where In office Bookings happen. Leave it empty if there's no office to visit."
          isChanged={address.isChanged}
          note={
            <PrototypeNote note="API gap: there is no office address setting yet; assumed a new string row `office_address` (multi-line, blank = not set). Open question: where it shows (In office Bookings, Tutors' Session details, the bot's replies to Guardians) is not decided here." />
          }
        >
          {({ controlId, describedBy }) => (
            <textarea
              id={controlId}
              rows={2}
              autoComplete="street-address"
              placeholder={"Street, suite\nCity, state ZIP"}
              value={address.value}
              aria-describedby={describedBy}
              onChange={(event) => address.onChange(event.target.value)}
              className={cn(getControlClasses(false), "h-auto min-h-[72px] w-full resize-y rounded-[20px] px-4 py-2.5 leading-6")}
            />
          )}
        </FieldFrame>
        <FieldFrame
          label="Country code for phone numbers"
          help="Used when a number is typed without a country code, like a Guardian's phone number."
          isChanged={country.isChanged}
        >
          {({ controlId, describedBy }) => (
            <SelectControl
              id={controlId}
              aria-describedby={describedBy}
              options={countryOptions}
              label="Country code for phone numbers"
              value={country.value}
              onChange={(event) => country.onChange(event.target.value)}
              className="max-w-[320px]"
            />
          )}
        </FieldFrame>
      </div>
      {isZoneLocked ? (
        <div className="flex flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-2 text-[14px] leading-5 font-semibold">
            Time zone
            <Badge tone="neutral" icon={Lock}>
              Locked
            </Badge>
            <PrototypeNote note="Open question: the business time zone never changes in practice. Show it here read-only, or drop it from Settings altogether?" />
          </span>
          <p className="text-[15px] leading-6">{getTimeZoneLabel(zone.value)}</p>
          <p className="px-1 text-[13px] leading-[18px] text-(--tl-muted)">
            Every Booking, reminder and Time off uses this clock. It can't change
            once the first Booking exists; ask your developer if it must.
          </p>
        </div>
      ) : (
        <FieldFrame
          label="Time zone"
          help="Every Booking, reminder and Time off uses this clock. It locks once the first Booking is made."
          isChanged={zone.isChanged}
        >
          {({ controlId, describedBy }) => (
            <SelectControl
              id={controlId}
              aria-describedby={describedBy}
              options={zoneOptions}
              label="Time zone"
              value={zone.value}
              onChange={(event) => zone.onChange(event.target.value)}
              className="max-w-[420px]"
            />
          )}
        </FieldFrame>
      )}
    </SectionCard>
  );
}
