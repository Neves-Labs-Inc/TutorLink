// Office: the number Tutors call, where In office Bookings happen, the
// country code for numbers typed without one, and the business time zone
// (read-only: it never changes once Bookings exist).
import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { Badge } from "@/components/kit/components/badges";
import { SectionCard } from "@/components/kit/components/section-card";
import Select from "@/components/kit/components/select";
import { FieldFrame } from "@/components/kit/components/settings-form";
import type { SelectOption } from "@/components/kit/types/select";
import {
  OFFICE_ADDRESS_KEY,
  OFFICE_PHONE_KEY,
} from "@/lib/settings/setting-rules";
import { BUSINESS_TIMEZONE_KEY } from "@/lib/settings/settings-groups";
import { getTimeZoneName } from "@/lib/settings/time-zone-names";
import FieldGrid from "@/pages/settings/components/field-grid";
import OfficeAddressField from "@/pages/settings/components/office-address-field";
import OfficePhoneField from "@/pages/settings/components/office-phone-field";
import type { SettingsForm } from "@/pages/settings/hooks/use-settings-form";

const COUNTRY_KEY = "default_phone_country_code";
const COUNTRY_CODES: SelectOption[] = [
  { value: "1", label: "+1 United States and Canada" },
  { value: "52", label: "+52 Mexico" },
  { value: "55", label: "+55 Brazil" },
  { value: "57", label: "+57 Colombia" },
  { value: "58", label: "+58 Venezuela" },
  { value: "34", label: "+34 Spain" },
];

// A saved code outside the list stays selectable, or opening the page
// would quietly change it.
function getCountryOptions(saved: string): SelectOption[] {
  const isListed = COUNTRY_CODES.some((option) => option.value === saved);
  return isListed
    ? COUNTRY_CODES
    : [{ value: saved, label: `+${saved}` }, ...COUNTRY_CODES];
}

type OfficeGroupProps = { form: SettingsForm };

export default function OfficeGroup({ form }: OfficeGroupProps): ReactNode {
  const country = form.bind(COUNTRY_KEY);

  return (
    <SectionCard
      id="office"
      title="Office"
      description="Contact details and the clock everything runs on."
    >
      <FieldGrid>
        <OfficePhoneField
          field={form.bind(OFFICE_PHONE_KEY)}
          onBlur={() => form.touch(OFFICE_PHONE_KEY)}
        />
        <OfficeAddressField
          field={form.bind(OFFICE_ADDRESS_KEY)}
          onBlur={() => form.touch(OFFICE_ADDRESS_KEY)}
        />
        <FieldFrame
          label="Country code for phone numbers"
          help="Used when a number is typed without a country code, like a Guardian’s phone number."
          isChanged={country.isChanged}
        >
          {({ controlId, describedBy }) => (
            <Select
              variant="field"
              id={controlId}
              aria-describedby={describedBy}
              label="Country code for phone numbers"
              options={getCountryOptions(country.value)}
              value={country.value}
              onValueChange={country.onChange}
              className="max-w-[320px]"
            />
          )}
        </FieldFrame>
      </FieldGrid>
      <div className="flex flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-2 text-[14px] leading-5 font-semibold text-(--tl-ink)">
          Time zone
          <Badge tone="neutral" icon={Lock}>
            Locked
          </Badge>
        </span>
        <p className="px-1 text-[15px] leading-6 text-(--tl-ink)">
          {getTimeZoneName(form.valueOf(BUSINESS_TIMEZONE_KEY))}
        </p>
        <p className="px-1 text-[13px] leading-[18px] text-(--tl-muted)">
          Every Booking, reminder and Time off uses this clock. It can’t change
          once Bookings exist; ask your developer if it must.
        </p>
      </div>
    </SectionCard>
  );
}
