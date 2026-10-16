// Developer only: the WhatsApp template ids behind Booking reminders.
// Admins never receive these rows; a Developer sees them here.
import type { ReactNode } from "react";
import { Code } from "lucide-react";
import { Badge } from "@/pages/prototype/shell-kit/kit/components/badges";
import { cn } from "@/pages/prototype/shell-kit/kit/tokens";
import SectionCard from "@/pages/prototype/settings/components/section-card";
import { bindField } from "@/pages/prototype/settings/lib/bind-field";
import FieldFrame from "@/pages/prototype/settings/components/field-frame";
import { getControlClasses } from "@/pages/prototype/settings/lib/control-classes";
import type { SettingsApi } from "@/pages/prototype/settings/hooks/use-settings";

const TEMPLATE_FIELDS = [
  { key: "reminder_template_sid_en", label: "Reminder message id, English" },
  { key: "reminder_template_sid_es", label: "Reminder message id, Spanish" },
];

type DeveloperSectionProps = { settings: SettingsApi };

export default function DeveloperSection({
  settings,
}: DeveloperSectionProps): ReactNode {
  return (
    <SectionCard
      id="developer"
      title="Developer only"
      description="Hidden from Admins. Fill these in once WhatsApp approves the reminder message; reminders stay Not set up while either is empty."
      badge={
        <Badge tone="primary" icon={Code}>
          Developer
        </Badge>
      }
    >
      <div className="grid gap-6 @3xl:grid-cols-2">
        {TEMPLATE_FIELDS.map((field) => {
          const bound = bindField(settings, field.key);
          return (
            <FieldFrame
              key={field.key}
              label={field.label}
              help={bound.value === "" ? "Empty: not approved yet." : `Key: ${field.key}`}
              isChanged={bound.isChanged}
            >
              {({ controlId, describedBy }) => (
                <input
                  id={controlId}
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="HX…"
                  value={bound.value}
                  aria-describedby={describedBy}
                  onChange={(event) => bound.onChange(event.target.value.trim())}
                  className={cn(getControlClasses(false), "w-full px-4 font-mono text-[14px]")}
                />
              )}
            </FieldFrame>
          );
        })}
      </div>
    </SectionCard>
  );
}
