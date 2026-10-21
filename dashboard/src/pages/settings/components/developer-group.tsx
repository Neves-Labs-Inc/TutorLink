// Developer only: the WhatsApp template ids behind Booking reminders.
// Admins never receive these rows; only a Developer sees this group.
import type { ReactNode } from "react";
import { Code } from "lucide-react";
import { Badge } from "@/components/kit/components/badges";
import { SectionCard } from "@/components/kit/components/section-card";
import { FieldFrame } from "@/components/kit/components/settings-form";
import { getControlClasses } from "@/components/kit/lib/control-classes";
import { cn } from "@/components/kit/tokens";
import FieldGrid from "@/pages/settings/components/field-grid";
import type { SettingsForm } from "@/pages/settings/hooks/use-settings-form";

const TEMPLATE_FIELDS = [
  { key: "reminder_template_sid_en", label: "Reminder message id, English" },
  { key: "reminder_template_sid_es", label: "Reminder message id, Spanish" },
];

type DeveloperGroupProps = { form: SettingsForm };

export default function DeveloperGroup({
  form,
}: DeveloperGroupProps): ReactNode {
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
      <FieldGrid>
        {TEMPLATE_FIELDS.map(({ key, label }) => {
          const field = form.bind(key);
          return (
            <FieldFrame
              key={key}
              label={label}
              help={field.value === "" ? "Empty: not approved yet." : `Key: ${key}`}
              isChanged={field.isChanged}
            >
              {({ controlId, describedBy }) => (
                <input
                  id={controlId}
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="HX…"
                  value={field.value}
                  aria-describedby={describedBy}
                  // The API strips ids anyway; a stray space would read as a change.
                  onChange={(event) => field.onChange(event.target.value.trim())}
                  className={cn(
                    getControlClasses(false),
                    "h-11 rounded-full px-4 font-mono text-[14px]",
                  )}
                />
              )}
            </FieldFrame>
          );
        })}
      </FieldGrid>
    </SectionCard>
  );
}
