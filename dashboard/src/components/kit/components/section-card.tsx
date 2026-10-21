// One settings group: title and one-line purpose on top, fields below.
// A collapsible group (Sign-in protection) starts closed unless told.
import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { getSectionHeadingId } from "@/components/kit/lib/section-anchors";
import { CARD, cn, HEADING } from "@/components/kit/tokens";

type SectionCardProps = {
  id: string;
  title: string;
  description: string;
  badge?: ReactNode;
  isCollapsible?: boolean;
  isInitiallyOpen?: boolean;
  // Controlled open state for a collapsible card. Leave both out and the
  // card keeps its own.
  isOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
  children: ReactNode;
};

export function SectionCard({
  id,
  title,
  description,
  badge,
  isCollapsible = false,
  isInitiallyOpen = false,
  isOpen: controlledIsOpen,
  onOpenChange,
  children,
}: SectionCardProps): ReactNode {
  const [ownIsOpen, setOwnIsOpen] = useState(!isCollapsible || isInitiallyOpen);
  const isOpen = controlledIsOpen ?? ownIsOpen;
  // Only an open the person caused rises; the first paint stays still.
  const [hasToggled, setHasToggled] = useState(false);
  const headingId = getSectionHeadingId(id);

  function handleToggle(): void {
    setOwnIsOpen(!isOpen);
    setHasToggled(true);
    onOpenChange?.(!isOpen);
  }

  const titleId = `${id}-title`;
  const text = (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <span id={titleId} className={HEADING}>
          {title}
        </span>
        {badge}
      </span>
      <span className="text-[14px] leading-5 text-(--tl-muted)">
        {description}
      </span>
    </span>
  );

  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={cn(CARD, "scroll-mt-4 p-4 @2xl:p-5")}
    >
      {/* The button sits inside the h2 so the heading role survives. */}
      <h2 id={headingId} tabIndex={-1} className="outline-none">
        {isCollapsible ? (
          <button
            type="button"
            aria-expanded={isOpen}
            aria-controls={`${id}-body`}
            onClick={handleToggle}
            className="-m-2 flex w-[calc(100%+16px)] cursor-pointer items-start justify-between gap-4 rounded-[16px] p-2 text-left transition-colors duration-150 hover:bg-(--tl-tint) active:bg-(--tl-tint-strong)"
          >
            {text}
            <ChevronDown
              aria-hidden
              className={cn(
                "mt-1 size-5 shrink-0 text-(--tl-muted) transition-transform duration-150",
                isOpen && "rotate-180",
              )}
            />
          </button>
        ) : (
          text
        )}
      </h2>
      {isOpen && (
        <div
          id={`${id}-body`}
          className={cn(
            "mt-6 flex flex-col gap-6",
            isCollapsible && hasToggled && "kit-rise",
          )}
        >
          {children}
        </div>
      )}
    </section>
  );
}
