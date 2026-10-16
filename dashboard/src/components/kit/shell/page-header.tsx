// The top of every page: eyebrow, Lato title, one primary action,
// sub-page tabs, then an optional toolbar. On phones the primary action
// shrinks to a round icon button beside the title (it keeps its name for
// screen readers), and the tabs scroll sideways.
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { TITLE } from "@/components/kit/tokens";
import { Button, IconButton } from "@/components/kit/components/button";

export type PageAction = {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
};

type PageHeaderProps = {
  eyebrow?: ReactNode;
  title: string;
  description?: ReactNode;
  primaryAction?: PageAction;
  secondaryActions?: ReactNode;
  tabs?: ReactNode;
  children?: ReactNode;
};

export function PageHeader({
  eyebrow,
  title,
  description,
  primaryAction,
  secondaryActions,
  tabs,
  children,
}: PageHeaderProps): ReactNode {
  return (
    <div className="flex flex-col gap-5 pt-5 pb-6 @5xl:pt-6 @5xl:pb-8">
      <div className="flex items-start justify-between gap-4 @2xl:items-end">
        <div className="min-w-0">
          {eyebrow && <div className="mb-3">{eyebrow}</div>}
          <h1 className={TITLE}>{title}</h1>
          {description && (
            <p className="mt-1 text-[15px] leading-6 text-(--tl-muted)">
              {description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {secondaryActions && (
            <div className="hidden items-center gap-2 @3xl:flex">
              {secondaryActions}
            </div>
          )}
          {primaryAction && (
            <>
              <span className="hidden @2xl:inline-flex">
                <Button
                  variant="primary"
                  icon={primaryAction.icon}
                  onClick={primaryAction.onClick}
                >
                  {primaryAction.label}
                </Button>
              </span>
              <IconButton
                variant="primary"
                icon={primaryAction.icon}
                label={primaryAction.label}
                onClick={primaryAction.onClick}
                className="@2xl:hidden"
              />
            </>
          )}
        </div>
      </div>
      {tabs}
      {children}
    </div>
  );
}

type EyebrowPillProps = { children: ReactNode };

export function EyebrowPill({ children }: EyebrowPillProps): ReactNode {
  return (
    <span className="inline-flex h-7 items-center rounded-full bg-(--tl-tint) px-3 text-[12px] font-semibold tracking-[0.14em] text-(--tl-primary-ink) uppercase">
      {children}
    </span>
  );
}
