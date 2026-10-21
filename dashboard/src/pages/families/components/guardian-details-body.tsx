// Guardian details' body: identity, contact, language and reminders
// rows, their Children (each opens Child details stacked) and their
// live Homes, read-only (Homes are managed on the family page).
import type { ReactNode } from "react";
import { BellRing, ChevronRight, Languages, MapPin, Phone, Users } from "lucide-react";
import { ArchivedBadge, Avatar } from "@/components/kit/components/badges";
import { DetailRow } from "@/components/kit/components/detail";
import { cn, EYEBROW } from "@/components/kit/tokens";
import { joinNames } from "@/lib/families/guardian-archive";
import {
  formatPhone,
  getLanguageLabel,
  getRemindersLabel,
} from "@/lib/families/guardian-labels";
import { gradeName } from "@/lib/grades/grades";
import { DetailsIdentity } from "@/pages/families/components/details-states";
import {
  RECORD_CARD,
  RECORD_CARD_ARCHIVED,
  RECORD_CHEVRON,
  SECTION_HEAD,
  SUNK_WELL,
} from "@/pages/families/lib/family-classes";
import type { ClientChildRead, ClientRead, HomeRead } from "@/types/families";

type GuardianDetailsBodyProps = {
  guardian: ClientRead;
  onOpenChild: (childId: string) => void;
};

export default function GuardianDetailsBody({
  guardian,
  onOpenChild,
}: GuardianDetailsBodyProps): ReactNode {
  return (
    <>
      <DetailsIdentity name={guardian.name} />
      <div className="mt-6 flex flex-col gap-5">
        <DetailRow icon={Phone} label="WhatsApp">
          <p className="font-semibold tabular-nums">
            {formatPhone(guardian.phone_number)}
          </p>
        </DetailRow>
        <DetailRow icon={Languages} label="Guardian language">
          <p className="font-semibold">{getLanguageLabel(guardian.language)}</p>
          {guardian.language === null && (
            <p className="text-[13px] leading-[18px] text-(--tl-muted)">
              Not detected yet, so English
            </p>
          )}
        </DetailRow>
        <DetailRow icon={BellRing} label="Booking reminders">
          <p className="font-semibold">{getRemindersLabel(guardian.reminders)}</p>
          {guardian.reminders_blocked_by_whatsapp && (
            <p className="text-[13px] leading-[18px] text-(--tl-warning)">
              WhatsApp is blocking reminders to this number
            </p>
          )}
        </DetailRow>
      </div>
      <GuardianChildren guardian={guardian} onOpenChild={onOpenChild} />
      <GuardianHomes guardian={guardian} />
    </>
  );
}

type GuardianChildrenProps = GuardianDetailsBodyProps;

function GuardianChildren({
  guardian,
  onOpenChild,
}: GuardianChildrenProps): ReactNode {
  const { children } = guardian;
  const headingId = `guardian-${guardian.id}-children`;
  const heading = children.length === 1 ? "Child" : `Children · ${children.length}`;
  return (
    <section aria-labelledby={headingId} className="mt-8">
      <div className={SECTION_HEAD}>
        <h3 id={headingId} className={EYEBROW}>
          {heading}
        </h3>
      </div>
      {children.length === 0 ? (
        <p className={SUNK_WELL}>No Children yet</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {children.map((child) => (
            <li key={child.id}>
              <ChildRow child={child} onOpen={() => onOpenChild(child.id)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type ChildRowProps = { child: ClientChildRead; onOpen: () => void };

function ChildRow({ child, onOpen }: ChildRowProps): ReactNode {
  const grade =
    child.grade_level === null ? "Grade not set" : gradeName(child.grade_level);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${child.name}`}
      className={cn(
        RECORD_CARD,
        "min-h-[64px]",
        child.archived && RECORD_CARD_ARCHIVED,
      )}
    >
      <Avatar name={child.name} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] leading-6 font-semibold">
          {child.name}
        </span>
        <span className="block text-[13px] leading-[18px] text-(--tl-muted)">
          {grade}
        </span>
      </span>
      {child.archived && <ArchivedBadge />}
      <ChevronRight aria-hidden className={RECORD_CHEVRON} />
    </button>
  );
}

type GuardianHomesProps = { guardian: ClientRead };

function GuardianHomes({ guardian }: GuardianHomesProps): ReactNode {
  const homes = guardian.homes.filter((home) => !home.archived);
  const headingId = `guardian-${guardian.id}-homes`;
  return (
    <section aria-labelledby={headingId} className="mt-8">
      <div className={SECTION_HEAD}>
        <h3 id={headingId} className={EYEBROW}>
          {`Homes · ${homes.length}`}
        </h3>
      </div>
      {homes.length === 0 ? (
        <p className={SUNK_WELL}>No Homes yet.</p>
      ) : (
        <ul aria-label="Homes" className="flex flex-col gap-2">
          {homes.map((home) => (
            <li key={home.id}>
              <HomeRow home={home} guardianId={guardian.id} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type HomeRowProps = { home: HomeRead; guardianId: string };

function HomeRow({ home, guardianId }: HomeRowProps): ReactNode {
  const others = home.guardians.filter((owner) => owner.id !== guardianId);
  return (
    <div className="flex items-start gap-3 rounded-[16px] bg-(--tl-surface-sunk) px-4 py-3">
      <MapPin aria-hidden className="mt-0.5 size-[18px] shrink-0 text-(--tl-muted)" />
      <div className="min-w-0 flex-1">
        {home.label && (
          <p className="text-[13px] leading-[18px] font-semibold text-(--tl-ink-soft)">
            {home.label}
          </p>
        )}
        <p className="text-[14px] leading-5 font-medium break-words">
          {home.address}
        </p>
        {home.directions && (
          <p className="text-[13px] leading-[18px] text-(--tl-muted)">
            {home.directions}
          </p>
        )}
        {others.length > 0 && (
          <p className="mt-1 flex items-center gap-1.5 text-[13px] text-(--tl-ink-soft)">
            <Users aria-hidden className="size-4 shrink-0" />
            {`Shared with ${joinNames(others.map((owner) => owner.name))}`}
          </p>
        )}
      </div>
    </div>
  );
}
