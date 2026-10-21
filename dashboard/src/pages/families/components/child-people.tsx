// A Child's Guardians (each opens Guardian details stacked) and where
// the Child can be booked: every live Home of their Guardians, then In
// office. Read-only.
import type { ReactNode } from "react";
import { Building2, ChevronRight, MapPin } from "lucide-react";
import {
  ArchivedBadge,
  Avatar,
  RemindersBadge,
} from "@/components/kit/components/badges";
import { TextLink } from "@/components/kit/components/button";
import { cn, EYEBROW } from "@/components/kit/tokens";
import {
  formatPhone,
  getLanguageLabel,
  getRemindersLabel,
} from "@/lib/families/guardian-labels";
import {
  RECORD_CARD,
  RECORD_CARD_ARCHIVED,
  RECORD_CHEVRON,
  SECTION_HEAD,
} from "@/pages/families/lib/family-classes";
import type { ChildDetail, ChildGuardianRead } from "@/types/families";

const PLACE_ROW =
  "flex items-start gap-3 rounded-[16px] bg-(--tl-surface-sunk) px-4 py-3";
const PLACE_ICON = "mt-0.5 size-4 shrink-0 text-(--tl-muted)";

type ChildPeopleProps = {
  child: ChildDetail;
  onOpenGuardian: (guardianId: string) => void;
};

export default function ChildPeople({
  child,
  onOpenGuardian,
}: ChildPeopleProps): ReactNode {
  const { guardians } = child;
  const homes = child.homes.filter((home) => !home.archived);
  const guardiansId = `child-${child.id}-guardians`;
  const placesId = `child-${child.id}-places`;
  const heading =
    guardians.length === 1 ? "Guardian" : `Guardians · ${guardians.length}`;
  return (
    <>
      <section aria-labelledby={guardiansId} className="mt-8">
        <div className={SECTION_HEAD}>
          <h3 id={guardiansId} className={EYEBROW}>
            {heading}
          </h3>
        </div>
        <ul className="flex flex-col gap-2">
          {guardians.map((guardian) => (
            <li key={guardian.id}>
              <GuardianRow
                guardian={guardian}
                onOpen={() => onOpenGuardian(guardian.id)}
              />
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby={placesId} className="mt-8">
        <div className={SECTION_HEAD}>
          <h3 id={placesId} className={EYEBROW}>
            Can be booked at
          </h3>
        </div>
        <ul className="flex flex-col gap-2">
          {homes.map((home) => (
            <li key={home.id} className={PLACE_ROW}>
              <MapPin aria-hidden className={PLACE_ICON} />
              <div className="min-w-0 flex-1">
                {home.label && (
                  <p className="text-[13px] leading-[18px] font-semibold text-(--tl-ink-soft)">
                    {home.label}
                  </p>
                )}
                <p className="text-[14px] leading-5 font-medium break-words">
                  {home.address}
                </p>
                <p className="mt-0.5 flex flex-wrap gap-x-3">
                  {home.guardians.map((owner) => (
                    <TextLink
                      key={owner.id}
                      className="text-[13px]"
                      onClick={() => onOpenGuardian(owner.id)}
                    >
                      {`${owner.name}’s Home`}
                    </TextLink>
                  ))}
                </p>
              </div>
            </li>
          ))}
          <li className={PLACE_ROW}>
            <Building2 aria-hidden className={PLACE_ICON} />
            <span className="text-[14px] leading-5 font-medium">In office</span>
          </li>
        </ul>
      </section>
    </>
  );
}

type GuardianRowProps = { guardian: ChildGuardianRead; onOpen: () => void };

function GuardianRow({ guardian, onOpen }: GuardianRowProps): ReactNode {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open Guardian details: ${guardian.name}`}
      className={cn(
        RECORD_CARD,
        "min-h-[72px]",
        guardian.archived && RECORD_CARD_ARCHIVED,
      )}
    >
      <Avatar name={guardian.name} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] leading-6 font-semibold">
          {guardian.name}
        </span>
        {/* Wraps rather than truncates: from 672px the badge shares the
            440px panel's row, and the language must stay readable. */}
        <span className="block text-[13px] leading-[18px] break-words text-(--tl-muted) tabular-nums">
          {`${formatPhone(guardian.phone_number)} · ${getLanguageLabel(guardian.language)}`}
        </span>
      </span>
      <span className="hidden @md:inline-flex">
        {guardian.archived ? (
          <ArchivedBadge />
        ) : (
          <RemindersBadge state={getRemindersLabel(guardian.reminders)} />
        )}
      </span>
      <ChevronRight aria-hidden className={RECORD_CHEVRON} />
    </button>
  );
}
