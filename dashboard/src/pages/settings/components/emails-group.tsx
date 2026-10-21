// Emails: the two templates the dashboard sends. Each row opens its own
// editor, which saves on its own, so the page Save bar never counts them.
import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronRight, KeyRound, Mail } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SectionCard } from "@/components/kit/components/section-card";
import { cn, TONE_CLASSES } from "@/components/kit/tokens";
import { TEMPLATE_SECTIONS, normalizeBrandColor } from "@/lib/settings/emailTemplates";
import type {
  TemplateSectionConfig,
  TemplateSectionId,
} from "@/lib/settings/emailTemplates";
import EmailEditor from "@/pages/settings/components/email-editor";
import type { SettingsForm } from "@/pages/settings/hooks/use-settings-form";

const TEMPLATE_META: Record<
  TemplateSectionId,
  { icon: LucideIcon; when: string }
> = {
  invite: { icon: Mail, when: "Sent when you invite someone to the dashboard." },
  password_reset: {
    icon: KeyRound,
    when: "Sent when someone asks to reset their password.",
  },
};

type EmailsGroupProps = { form: SettingsForm };

export default function EmailsGroup({ form }: EmailsGroupProps): ReactNode {
  const [openId, setOpenId] = useState<TemplateSectionId | null>(null);

  return (
    <SectionCard
      id="emails"
      title="Emails"
      description="The emails Staff get to set up or reset their password. Open one to change its wording or button colour."
    >
      <ul className="flex flex-col gap-2">
        {TEMPLATE_SECTIONS.map((section) => (
          <li key={section.id}>
            <EmailRow
              section={section}
              subject={form.valueOf(section.keys.subject)}
              brandColor={form.valueOf(section.brandColorKey)}
              onOpen={() => setOpenId(section.id)}
            />
          </li>
        ))}
      </ul>
      {/* All mounted, each driven by isOpen, so the exit plays. */}
      {TEMPLATE_SECTIONS.map((section) => (
        <EmailEditor
          key={section.id}
          section={section}
          saved={{
            subject: form.valueOf(section.keys.subject),
            body: form.valueOf(section.keys.body),
            brandColor: form.valueOf(section.brandColorKey),
          }}
          isOpen={openId === section.id}
          onClose={() => setOpenId(null)}
        />
      ))}
    </SectionCard>
  );
}

type EmailRowProps = {
  section: TemplateSectionConfig;
  subject: string;
  brandColor: string;
  onOpen: () => void;
};

function EmailRow({
  section,
  subject,
  brandColor,
  onOpen,
}: EmailRowProps): ReactNode {
  const { icon: Icon, when } = TEMPLATE_META[section.id];
  const hex = normalizeBrandColor(brandColor);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative flex min-h-[72px] w-full cursor-pointer items-center gap-4 rounded-[16px] border border-(--tl-border) bg-(--tl-surface) px-4 py-3 text-left transition-colors duration-150 hover:border-(--tl-hero) hover:bg-(--tl-tint) active:bg-(--tl-tint-strong)"
    >
      <span
        className={cn(
          "inline-flex size-10 shrink-0 items-center justify-center rounded-[14px]",
          TONE_CLASSES.primary,
        )}
      >
        <Icon aria-hidden className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] leading-6 font-semibold">
          {section.title} email
        </span>
        <span className="block text-[13px] leading-[18px] text-(--tl-muted)">
          {when}
        </span>
        <span className="block truncate text-[13px] leading-[18px] text-(--tl-ink-soft)">
          Subject: {subject}
        </span>
      </span>
      {/* The dot is the saved colour: data, not a design colour. */}
      <span
        aria-hidden
        className="size-5 shrink-0 rounded-full border border-(--tl-border)"
        style={{ backgroundColor: hex }}
      />
      {/* The row is `relative` so this absolute text stays inside it:
          otherwise it pins to the kit root, overflows it, and lets the
          whole kit scroll away under scrollIntoView. */}
      <span className="sr-only">Button colour {hex}</span>
      <ChevronRight
        aria-hidden
        className="size-5 shrink-0 text-(--tl-muted) transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0"
      />
    </button>
  );
}
