// Sign-in protection: the eight rate-limit keys as four plain rules,
// "after N tries within T". Starts collapsed, since it is rarely touched
// and a bad value locks Staff out.
import { useState } from "react";
import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { InfoTip } from "@/components/kit/components/info-tip";
import { SectionCard } from "@/components/kit/components/section-card";
import {
  DurationField,
  FieldFrame,
} from "@/components/kit/components/settings-form";
import { getControlClasses } from "@/components/kit/lib/control-classes";
import { cn, TONE_CLASSES } from "@/components/kit/tokens";
import { WINDOW_UNITS } from "@/lib/settings/duration-units";
import type { SettingsForm } from "@/pages/settings/hooks/use-settings-form";

type Rule = { prefix: string; title: string; body: string; tip: string };

const RULES: Rule[] = [
  {
    prefix: "login_rate_limit_email",
    title: "Wrong passwords for one email",
    body: "Then that email can’t sign in until the time is up.",
    tip: "Counts wrong passwords for one email address. Sign-in shows the wait, never which limit was hit.",
  },
  {
    prefix: "login_rate_limit_ip",
    title: "Sign-in tries from one network",
    body: "Counts every email tried from the same internet connection, so set it above the office’s own use.",
    tip: "Everyone in the office shares one connection, so a low number here can lock out the whole office at once.",
  },
  {
    prefix: "forgot_password_rate_limit_email",
    title: "Password reset emails to one address",
    body: "Stops someone flooding a Staff member’s inbox.",
    tip: "Extra requests still say “Check your email”, but no email is sent until the time is up.",
  },
  {
    prefix: "forgot_password_rate_limit_ip",
    title: "Password reset requests from one network",
    body: "Counts every address asked for from the same connection.",
    tip: "Stops one connection asking for reset links for many addresses.",
  },
];

const SIGN_IN_KEYS = RULES.flatMap((rule) => [
  `${rule.prefix}_max_attempts`,
  `${rule.prefix}_window_seconds`,
]);

type SignInGroupProps = { form: SettingsForm };

export default function SignInGroup({ form }: SignInGroupProps): ReactNode {
  const [isOpen, setIsOpen] = useState(false);
  // A shown error keeps the card open, so it can't hide behind the head.
  const hasError = SIGN_IN_KEYS.some((key) => form.errorOf(key) !== undefined);

  return (
    <SectionCard
      id="sign-in"
      title="Sign-in protection"
      description="Slows down anyone guessing passwords. The defaults suit most offices."
      isCollapsible
      isOpen={isOpen || hasError}
      onOpenChange={(next) => {
        // The head can't close it over an error, nor remember that click.
        if (!hasError) setIsOpen(next);
      }}
    >
      <p
        className={cn(
          "flex items-start gap-3 rounded-[16px] p-4 text-[14px] leading-5",
          TONE_CLASSES.warning,
        )}
      >
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          These apply to everyone, you included. Set them too low and Staff get
          locked out of the dashboard.
        </span>
      </p>
      {RULES.map((rule) => (
        <RuleFields key={rule.prefix} rule={rule} form={form} />
      ))}
    </SectionCard>
  );
}

type RuleFieldsProps = { rule: Rule; form: SettingsForm };

function RuleFields({ rule, form }: RuleFieldsProps): ReactNode {
  const triesKey = `${rule.prefix}_max_attempts`;
  const windowKey = `${rule.prefix}_window_seconds`;
  const tries = form.bind(triesKey);
  const window = form.bind(windowKey);
  const titleId = `${rule.prefix}-title`;

  return (
    <fieldset
      aria-labelledby={titleId}
      className="flex min-w-0 flex-col gap-3 border-t border-(--tl-border) pt-5 first-of-type:border-t-0 first-of-type:pt-0"
    >
      <legend className="float-left flex w-full items-center gap-2 p-0">
        <span id={titleId} className="text-[15px] leading-6 font-semibold">
          {rule.title}
        </span>
        <InfoTip label={`About ${rule.title}`}>{rule.tip}</InfoTip>
      </legend>
      <p className="text-[13px] leading-[18px] text-(--tl-muted)">
        {rule.body}
      </p>
      <div className="grid gap-4 @2xl:grid-cols-[180px_minmax(0,1fr)]">
        <FieldFrame
          label="Tries allowed"
          error={tries.error}
          isChanged={tries.isChanged}
        >
          {({ controlId, describedBy }) => (
            <input
              id={controlId}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={tries.value}
              aria-describedby={describedBy}
              aria-invalid={tries.error ? true : undefined}
              onChange={(event) => tries.onChange(event.target.value)}
              onBlur={() => form.touch(triesKey)}
              className={cn(
                getControlClasses(Boolean(tries.error)),
                "h-11 w-24! rounded-full px-4 text-right tabular-nums",
              )}
            />
          )}
        </FieldFrame>
        <div onBlur={() => form.touch(windowKey)}>
          <DurationField label="Within" units={WINDOW_UNITS} {...window} />
        </div>
      </div>
    </fieldset>
  );
}
