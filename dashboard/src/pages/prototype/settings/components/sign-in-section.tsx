// Sign-in protection: the eight rate-limit keys as four plain rules,
// "after N tries within T". Starts collapsed, since it's rarely touched
// and a bad value locks Staff out.
import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/components/kit/tokens";
import SectionCard from "@/pages/prototype/settings/components/section-card";
import { bindField } from "@/pages/prototype/settings/lib/bind-field";
import FieldFrame from "@/pages/prototype/settings/components/field-frame";
import { getControlClasses } from "@/pages/prototype/settings/lib/control-classes";
import { DurationField } from "@/pages/prototype/settings/components/number-fields";
import PrototypeNote from "@/pages/prototype/settings/components/prototype-note";
import { SECONDS_UNITS } from "@/pages/prototype/settings/lib/units";
import type { SettingsApi } from "@/pages/prototype/settings/hooks/use-settings";

type Rule = { prefix: string; title: string; body: string };

const RULES: Rule[] = [
  {
    prefix: "login_rate_limit_email",
    title: "Wrong passwords for one email",
    body: "Then that email can't sign in until the time is up.",
  },
  {
    prefix: "login_rate_limit_ip",
    title: "Sign-in tries from one network",
    body: "Counts every email tried from the same internet connection, so set it above the office's own use.",
  },
  {
    prefix: "forgot_password_rate_limit_email",
    title: "Password reset emails to one address",
    body: "Stops someone flooding a Staff member's inbox.",
  },
  {
    prefix: "forgot_password_rate_limit_ip",
    title: "Password reset requests from one network",
    body: "Counts every address asked for from the same connection.",
  },
];

type SignInSectionProps = { settings: SettingsApi; isInitiallyOpen: boolean };

export default function SignInSection({
  settings,
  isInitiallyOpen,
}: SignInSectionProps): ReactNode {
  return (
    <SectionCard
      id="sign-in"
      title="Sign-in protection"
      description="Slows down anyone guessing passwords. The defaults suit most offices."
      isCollapsible
      isInitiallyOpen={isInitiallyOpen}
    >
      <p className="flex items-start gap-3 rounded-[16px] bg-(--tl-warning-tint) p-4 text-[14px] leading-5 text-(--tl-warning)">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          These apply to everyone, you included. Set them too low and Staff get
          locked out of the dashboard.
        </span>
      </p>
      {RULES.map((rule, index) => (
        <RuleFields
          key={rule.prefix}
          rule={rule}
          settings={settings}
          hasNote={index === 0}
        />
      ))}
    </SectionCard>
  );
}

type RuleFieldsProps = { rule: Rule; settings: SettingsApi; hasNote: boolean };

function RuleFields({ rule, settings, hasNote }: RuleFieldsProps): ReactNode {
  const attempts = bindField(settings, `${rule.prefix}_max_attempts`);
  const period = bindField(settings, `${rule.prefix}_window_seconds`);
  return (
    <fieldset className="flex flex-col gap-3 border-t border-(--tl-border) pt-5 first-of-type:border-t-0 first-of-type:pt-0">
      <legend className="sr-only">{rule.title}</legend>
      <div aria-hidden>
        <p className="text-[15px] leading-6 font-semibold">{rule.title}</p>
        <p className="text-[13px] leading-[18px] text-(--tl-muted)">
          {rule.body}
        </p>
      </div>
      <div className="grid gap-4 @2xl:grid-cols-[180px_minmax(0,1fr)]">
        <FieldFrame
          label="Tries allowed"
          error={attempts.error}
          isChanged={attempts.isChanged}
          note={
            hasNote && (
            <PrototypeNote note="API gap: the rate-limit keys have no bounds in settings_service (0 or a negative is accepted and would lock everyone out). The prototype refuses below 1 try and 1 minute." />
            )
          }
        >
          {({ controlId, describedBy }) => (
            <input
              id={controlId}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={attempts.value}
              aria-describedby={describedBy}
              aria-invalid={attempts.error ? true : undefined}
              onChange={(event) => attempts.onChange(event.target.value)}
              className={cn(getControlClasses(Boolean(attempts.error)), "w-24 px-4 text-right tabular-nums")}
            />
          )}
        </FieldFrame>
        <DurationField
          label="Within"
          units={SECONDS_UNITS}
          {...period}
        />
      </div>
    </fieldset>
  );
}
