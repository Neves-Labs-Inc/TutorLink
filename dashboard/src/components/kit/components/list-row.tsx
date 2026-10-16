// Lists fork B: a rich card row everywhere. The row queries its own
// width (it is a size container), so it lays out the same in a narrow
// column as on a phone: stacked below 672px, one line above.
// The row itself is the button that opens the record.
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CARD, cn } from "@/components/kit/tokens";

export type RowDetail = { icon: LucideIcon; text: string };

type ListRowProps = {
  leading: ReactNode;
  title: string;
  subtitle?: string;
  badges?: ReactNode;
  details?: RowDetail[];
  isMuted?: boolean;
  isStruck?: boolean;
  onOpen: () => void;
};

export function ListRow({
  leading,
  title,
  subtitle,
  badges,
  details = [],
  isMuted = false,
  isStruck = false,
  onOpen,
}: ListRowProps): ReactNode {
  return (
    <div className="@container">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          CARD,
          "group grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 px-4 py-4 text-left transition-colors duration-150 hover:border-(--tl-hero) active:bg-(--tl-tint) @2xl:min-h-[76px] @2xl:grid-cols-[auto_minmax(0,1fr)_minmax(0,0.9fr)_auto_auto] @2xl:gap-x-5 @2xl:px-5 @2xl:py-3",
          isMuted && "text-(--tl-muted)",
        )}
      >
        {leading}
        <span className="min-w-0">
          <span
            className={cn(
              "kit-display block truncate text-[17px] leading-6 font-bold",
              isStruck && "line-through decoration-(--tl-muted)",
            )}
          >
            {title}
          </span>
          {subtitle && (
            <span className="block truncate text-[13px] leading-[18px] text-(--tl-muted)">
              {subtitle}
            </span>
          )}
        </span>
        <ChevronRight
          aria-hidden
          className="size-5 text-(--tl-muted) transition-transform duration-150 group-hover:translate-x-0.5 @2xl:order-last"
        />
        {details.length > 0 && (
          <span className="order-2 col-span-3 flex min-w-0 flex-col gap-1.5 border-t border-(--tl-border) pt-3 @2xl:order-none @2xl:col-span-1 @2xl:border-t-0 @2xl:pt-0">
            {details.map((detail) => {
              const Icon = detail.icon;
              return (
                <span
                  key={detail.text}
                  className="flex min-w-0 items-center gap-2 text-[14px] text-(--tl-ink-soft)"
                >
                  <Icon
                    aria-hidden
                    className="size-4 shrink-0 text-(--tl-muted)"
                  />
                  <span className="truncate">{detail.text}</span>
                </span>
              );
            })}
          </span>
        )}
        {badges && (
          <span className="order-1 col-span-3 flex flex-wrap gap-1.5 @2xl:order-none @2xl:col-span-1 @2xl:justify-end">
            {badges}
          </span>
        )}
      </button>
    </div>
  );
}

type TimeBlockProps = { time: string; caption: string };

// The leading time chip used on Booking and Session rows.
export function TimeBlock({ time, caption }: TimeBlockProps): ReactNode {
  const [clock, meridiem] = time.split(" ");
  return (
    <span className="flex w-[72px] shrink-0 flex-col items-center rounded-[16px] bg-(--tl-tint) py-2 text-(--tl-primary-ink) tabular-nums">
      <span className="text-[16px] leading-6 font-semibold whitespace-nowrap">
        {clock}
        <span className="ml-0.5 text-[12px] font-medium">{meridiem}</span>
      </span>
      <span className="text-[12px] leading-4 font-medium">{caption}</span>
    </span>
  );
}
