// Emails: the two templates, each a row that opens its editor, where the
// subject, message and button colour are edited and saved together.
import type { ReactNode } from "react";
import { ChevronRight, KeyRound, Mail } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import SectionCard from "@/pages/prototype/settings/components/section-card";
import { TEMPLATE_SECTIONS } from "@/lib/settings/emailTemplates";
import type { TemplateSectionId } from "@/lib/settings/emailTemplates";
import type { SettingsApi } from "@/pages/prototype/settings/hooks/use-settings";

const TEMPLATE_META: Record<TemplateSectionId, { icon: LucideIcon; when: string }> = {
  invite: { icon: Mail, when: "Sent when you invite someone to the dashboard." },
  password_reset: {
    icon: KeyRound,
    when: "Sent when someone asks to reset their password.",
  },
};

type EmailsSectionProps = {
  settings: SettingsApi;
  onOpenTemplate: (id: TemplateSectionId) => void;
};

export default function EmailsSection({
  settings,
  onOpenTemplate,
}: EmailsSectionProps): ReactNode {
  const colour = settings.valueOf("email_brand_color");
  return (
    <SectionCard
      id="emails"
      title="Emails"
      description="The emails Staff get to set up or reset their password. Open one to change its wording or button colour."
    >
      <ul className="flex flex-col gap-2">
        {TEMPLATE_SECTIONS.map((section) => {
          const meta = TEMPLATE_META[section.id];
          const Icon = meta.icon;
          return (
            <li key={section.id}>
              <button
                type="button"
                onClick={() => onOpenTemplate(section.id)}
                className="flex min-h-[72px] w-full cursor-pointer items-center gap-4 rounded-[16px] border border-(--tl-border) bg-(--tl-surface) px-4 py-3 text-left transition-colors duration-150 hover:border-(--tl-primary) hover:bg-(--tl-tint)"
              >
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-(--tl-tint) text-(--tl-primary-ink)">
                  <Icon aria-hidden className="size-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] leading-6 font-semibold">
                    {section.title} email
                  </span>
                  <span className="block text-[13px] leading-[18px] text-(--tl-muted)">
                    {meta.when}
                  </span>
                  <span className="mt-1 block truncate text-[13px] leading-[18px] text-(--tl-ink-soft)">
                    Subject: {settings.valueOf(section.keys.subject)}
                  </span>
                </span>
                <span
                  aria-hidden
                  title={`Button colour ${colour}`}
                  className="size-5 shrink-0 rounded-full border border-(--tl-border)"
                  style={{ backgroundColor: colour }}
                />
                <ChevronRight aria-hidden className="size-5 shrink-0 text-(--tl-muted)" />
              </button>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
