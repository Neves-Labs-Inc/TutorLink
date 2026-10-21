// The one thing a Tutor needs at a glance: who, when, where. The whole
// card opens the details (directions, notes); it carries no buttons.
import type { ReactNode } from "react";
import { Building2, MapPin, Signpost } from "lucide-react";
import { KindBadge } from "@/components/kit/components/badges";
import { CARD, cn } from "@/components/kit/tokens";
import type { BookingSummary } from "@/lib/queries/bookings";
import {
  getPlaceLine,
  getSubjectLine,
  getTimeRange,
  isInOffice,
} from "@/pages/sessions/lib/session-labels";
import { getStartsIn } from "@/pages/sessions/lib/session-rules";

type NextUpCardProps = {
  session: BookingSummary;
  now: Date;
  onOpen: () => void;
};

export function NextUpCard({ session, now, onOpen }: NextUpCardProps): ReactNode {
  const PlaceIcon = isInOffice(session) ? Building2 : MapPin;
  const hasDirections = !isInOffice(session) && Boolean(session.home?.directions);
  return (
    <section aria-label="Next up" className="@container">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          CARD,
          "group flex w-full cursor-pointer flex-col gap-4 border-(--tl-hero) bg-(--tl-tint) p-5 text-left transition-colors duration-150 hover:bg-(--tl-tint-strong) active:border-(--tl-primary) active:bg-(--tl-tint-strong) @2xl:flex-row @2xl:items-center @2xl:gap-6 @2xl:p-6",
        )}
      >
        <span className="flex shrink-0 flex-col gap-1">
          <span className="text-[12px] leading-4 font-semibold tracking-[0.14em] text-(--tl-primary-ink) uppercase">
            Next up · {getStartsIn(session, now)}
          </span>
          <span className="kit-display text-[28px] leading-9 font-light whitespace-nowrap tabular-nums">
            {getTimeRange(session)}
          </span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1.5 @2xl:border-l @2xl:border-(--tl-hero) @2xl:pl-6">
          <span className="flex flex-wrap items-center gap-2">
            <span className="kit-display text-[20px] leading-7 font-bold">
              {session.child.name}
            </span>
            {session.kind === "evaluation" && <KindBadge kind="evaluation" />}
          </span>
          <span className="text-[15px] leading-6 text-(--tl-ink-soft)">
            {getSubjectLine(session)}
          </span>
          <span className="flex items-start gap-2 text-[14px] leading-5 text-(--tl-ink-soft)">
            <PlaceIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-(--tl-muted)" />
            <span className="min-w-0">{getPlaceLine(session)}</span>
          </span>
          {hasDirections && (
            <span className="flex items-center gap-2 text-[13px] leading-[18px] font-medium text-(--tl-primary-ink)">
              <Signpost aria-hidden className="size-4 shrink-0" />
              Has directions · tap for details
            </span>
          )}
        </span>
      </button>
    </section>
  );
}
