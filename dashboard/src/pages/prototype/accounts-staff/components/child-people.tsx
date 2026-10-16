// A Child's Guardians (each opens Guardian details) and where the Child
// can be booked: every Home of every Guardian, plus In office.
// Read-only here; Homes are managed on Guardian details.
import type { ReactNode } from "react";
import { Building2, ChevronRight, MapPin } from "lucide-react";
import { CARD, cn, EYEBROW } from "@/components/kit/tokens";
import {
  ArchivedBadge,
  Avatar,
  RemindersBadge,
} from "@/components/kit/components/badges";
import { TextLink } from "@/components/kit/components/button";
import {
  formatPhone,
  getLanguageLabel,
  getRemindersLabel,
} from "@/pages/prototype/accounts-staff/lib/labels";
import type { ChildDetail } from "@/pages/prototype/accounts-staff/types/api";

type ChildPeopleProps = {
  child: ChildDetail;
  onOpenGuardian: (id: string) => void;
};

export default function ChildPeople({ child, onOpenGuardian }: ChildPeopleProps): ReactNode {
  const homes = child.homes.filter((home) => !home.archived);
  return (
    <>
      <ul className="flex flex-col gap-2">
        {child.guardians.map((guardian) => (
          <li key={guardian.id}>
            <button
              type="button"
              onClick={() => onOpenGuardian(guardian.id)}
              aria-label={`Open Guardian details: ${guardian.name}`}
              className={cn(
                CARD,
                "flex min-h-[72px] w-full cursor-pointer items-center gap-3 p-4 text-left transition-colors duration-150 hover:border-(--tl-hero)",
              )}
            >
              <Avatar name={guardian.name} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">{guardian.name}</span>
                <span className="block truncate text-[13px] text-(--tl-muted) tabular-nums">
                  {formatPhone(guardian.phone_number)} · {getLanguageLabel(guardian.language)}
                </span>
              </span>
              <span className="hidden @md:inline-flex">
                {guardian.archived ? <ArchivedBadge /> : <RemindersBadge state={getRemindersLabel(guardian.reminders)} />}
              </span>
              <ChevronRight aria-hidden className="size-5 shrink-0 text-(--tl-muted)" />
            </button>
          </li>
        ))}
      </ul>

      <h3 className={cn(EYEBROW, "mt-8 mb-1")}>Can be booked at</h3>
      <p className="mb-3 text-[13px] text-(--tl-muted)">
        Their Guardians’ Homes, plus In office. Manage Homes on Guardian details.
      </p>
      <ul className="flex flex-col gap-2">
        {homes.map((home) => (
          <li key={home.id} className="flex items-start gap-3 rounded-[16px] bg-(--tl-surface-sunk) px-4 py-3">
            <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-(--tl-muted)" />
            <span className="min-w-0 flex-1">
              {home.label && <span className="block text-[13px] font-semibold text-(--tl-ink-soft)">{home.label}</span>}
              <span className="block text-[14px] leading-5 font-medium">{home.address}</span>
              <span className="mt-0.5 flex flex-wrap gap-x-3">
                {home.guardians.map((owner) => (
                  <TextLink key={owner.id} onClick={() => onOpenGuardian(owner.id)} className="text-[13px]">
                    {owner.name}’s Home
                  </TextLink>
                ))}
              </span>
            </span>
          </li>
        ))}
        <li className="flex items-center gap-3 rounded-[16px] bg-(--tl-surface-sunk) px-4 py-3">
          <Building2 aria-hidden className="size-4 shrink-0 text-(--tl-muted)" />
          <span className="text-[14px] font-medium">In office</span>
        </li>
      </ul>
    </>
  );
}
