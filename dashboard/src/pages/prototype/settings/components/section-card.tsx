// One settings group: title and one-line purpose on top, fields below.
// Collapsible groups (Sign-in protection) start closed.
import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { CARD, cn, HEADING } from "@/components/kit/tokens";

type SectionCardProps = {
  id: string;
  title: string;
  description: string;
  badge?: ReactNode;
  isCollapsible?: boolean;
  isInitiallyOpen?: boolean;
  children: ReactNode;
};

export default function SectionCard({
  id,
  title,
  description,
  badge,
  isCollapsible = false,
  isInitiallyOpen = false,
  children,
}: SectionCardProps): ReactNode {
  const [isOpen, setIsOpen] = useState(!isCollapsible || isInitiallyOpen);
  const headingId = `${id}-heading`;
  const heading = (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <h2 id={headingId} className={HEADING}>
          {title}
        </h2>
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
      aria-labelledby={headingId}
      className={cn(CARD, "scroll-mt-4 p-5 @2xl:p-6")}
    >
      {isCollapsible ? (
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={`${id}-body`}
          onClick={() => setIsOpen(!isOpen)}
          className="-m-2 flex w-[calc(100%+16px)] cursor-pointer items-start justify-between gap-4 rounded-[16px] p-2 text-left hover:bg-(--tl-tint)"
        >
          {heading}
          <ChevronDown
            aria-hidden
            className={cn(
              "mt-1 size-5 shrink-0 text-(--tl-muted) transition-transform duration-150",
              isOpen && "rotate-180",
            )}
          />
        </button>
      ) : (
        heading
      )}
      {isOpen && (
        <div id={`${id}-body`} className="mt-6 flex flex-col gap-6">
          {children}
        </div>
      )}
    </section>
  );
}
