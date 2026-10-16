// A whole-form message above the submit button: what went wrong and what
// to do next. Field mistakes stay under their field instead.
import type { ReactNode } from "react";
import { CircleAlert, Clock, Info, WifiOff } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/pages/prototype/shell-kit/kit/tokens";

type AlertTone = "danger" | "warning" | "info";

const TONES: Record<AlertTone, { classes: string; icon: LucideIcon }> = {
  danger: {
    classes: "bg-(--tl-danger-tint) text-(--tl-danger)",
    icon: CircleAlert,
  },
  warning: {
    classes: "bg-(--tl-warning-tint) text-(--tl-warning)",
    icon: Clock,
  },
  info: { classes: "bg-(--tl-info-tint) text-(--tl-info)", icon: Info },
};

type FormAlertProps = {
  tone: AlertTone;
  title: string;
  isOffline?: boolean;
  children?: ReactNode;
};

export default function FormAlert({
  tone,
  title,
  isOffline = false,
  children,
}: FormAlertProps): ReactNode {
  const { classes, icon } = TONES[tone];
  const Icon = isOffline ? WifiOff : icon;
  return (
    <div
      role={tone === "info" ? "status" : "alert"}
      className={cn("kit-fade flex gap-3 rounded-[20px] px-4 py-3", classes)}
    >
      <Icon aria-hidden className="mt-0.5 size-[18px] shrink-0" />
      <div className="min-w-0 text-[14px] leading-5">
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-0.5 text-(--tl-ink-soft)">{children}</div>}
      </div>
    </div>
  );
}
