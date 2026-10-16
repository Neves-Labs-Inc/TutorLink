// The family's Guardians and Homes, side by side from 1024px, stacked
// on phones. Guardians open their details. "Add guardian" and "Add home"
// live here (Franklin, #195); editing and archiving Homes stays on
// Guardian details for now.
import type { ReactNode } from "react";
import { ChevronRight, House, MapPin, UserPlus, Users } from "lucide-react";
import { CARD, cn, EYEBROW } from "@/components/kit/tokens";
import {
  ArchivedBadge,
  Avatar,
  RemindersBadge,
} from "@/components/kit/components/badges";
import { Button, TextLink } from "@/components/kit/components/button";
import OpenQuestion from "@/pages/prototype/accounts-staff/components/open-question";
import {
  formatPhone,
  getLanguageLabel,
  getRemindersLabel,
} from "@/pages/prototype/accounts-staff/lib/labels";
import type {
  ClientSummary,
  HomeRead,
} from "@/pages/prototype/accounts-staff/types/api";

const HOMES_QUESTION =
  "Homes are now added on the family page. Should they also be edited and archived here, or keep that on each Guardian’s details?";
const NO_GUARDIAN_QUESTION =
  "Can a Child exist with no Guardian? The bot only talks to Guardians, and Homes come only from Guardians, so this Child has nowhere to be booked but In office.";

type FamilyPeopleProps = {
  guardians: ClientSummary[];
  homes: HomeRead[];
  onOpenGuardian: (id: string) => void;
  onAddGuardian: () => void;
  onAddHome: () => void;
};

export default function FamilyPeople({
  guardians,
  homes,
  onOpenGuardian,
  onAddGuardian,
  onAddHome,
}: FamilyPeopleProps): ReactNode {
  const activeHomes = homes.filter((home) => !home.archived);
  const canAddHome = guardians.some((guardian) => !guardian.archived);

  return (
    <div className="grid gap-8 @5xl:grid-cols-2 @5xl:gap-6">
      <section aria-labelledby="family-guardians">
        <div className="mb-3 flex min-h-11 items-center justify-between gap-2">
          <h2 id="family-guardians" className={EYEBROW}>
            Guardians · {guardians.length}
          </h2>
          <Button variant="soft" icon={UserPlus} onClick={onAddGuardian}>
            Add guardian
          </Button>
        </div>
        {guardians.length === 0 ? (
          <div className="flex items-start gap-2 rounded-[20px] border border-dashed border-(--tl-field-border) p-4 text-[14px] text-(--tl-ink-soft)">
            <OpenQuestion question={NO_GUARDIAN_QUESTION} />
            <p className="pt-2.5">
              No Guardian yet. Add one so the bot can reach the family and Homes can be added.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {guardians.map((guardian) => (
              <li key={guardian.id}>
                <button
                  type="button"
                  onClick={() => onOpenGuardian(guardian.id)}
                  aria-label={`Open Guardian details: ${guardian.name}`}
                  className={cn(
                    CARD,
                    "flex min-h-[72px] w-full cursor-pointer items-center gap-3 p-4 text-left transition-colors duration-150 hover:border-(--tl-hero)",
                    guardian.archived && "text-(--tl-muted)",
                  )}
                >
                  <Avatar name={guardian.name} />
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
        )}
      </section>

      <section aria-labelledby="family-homes">
        <div className="mb-3 flex min-h-11 items-center justify-between gap-2">
          <h2 id="family-homes" className={EYEBROW}>
            Homes · {activeHomes.length}
          </h2>
          <span className="flex items-center">
            <OpenQuestion question={HOMES_QUESTION} />
            <Button variant="soft" icon={House} onClick={onAddHome} disabled={!canAddHome}>
              Add home
            </Button>
          </span>
        </div>
        {!canAddHome && (
          <p className="mb-2 px-1 text-[13px] text-(--tl-muted)">
            A Home is saved on a Guardian. Add a Guardian first.
          </p>
        )}
        {activeHomes.length === 0 ? (
          <p className={cn(CARD, "px-5 py-6 text-[15px] text-(--tl-muted)")}>
            No Homes yet. Bookings can still be In office.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {activeHomes.map((home) => (
              <li key={home.id} className={cn(CARD, "flex items-start gap-3 p-4")}>
                <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-(--tl-muted)" />
                <span className="min-w-0 flex-1">
                  {home.label && <span className="block text-[13px] font-semibold text-(--tl-ink-soft)">{home.label}</span>}
                  <span className="block text-[14px] leading-5 font-semibold">{home.address}</span>
                  {home.directions && (
                    <span className="mt-0.5 block text-[13px] leading-[18px] text-(--tl-muted)">{home.directions}</span>
                  )}
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 text-[13px]">
                    {home.guardians.length > 1 && <Users aria-hidden className="size-3.5 text-(--tl-muted)" />}
                    {home.guardians.map((owner) => (
                      <TextLink key={owner.id} onClick={() => onOpenGuardian(owner.id)} className="text-[13px]">
                        {owner.name}
                      </TextLink>
                    ))}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {activeHomes.length > 0 && (
          <p className="mt-2 px-1 text-[13px] text-(--tl-muted)">Change or archive a Home on its Guardian’s details.</p>
        )}
      </section>
    </div>
  );
}
