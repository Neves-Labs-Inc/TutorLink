// One live Home: label, address (wraps, never truncates), directions,
// and its owners as links to their details. The card itself isn't
// clickable; Edit and Archive are its own buttons.
import type { ReactNode } from "react";
import { Archive, MapPin, Pencil, Users } from "lucide-react";
import { IconButton, TextLink } from "@/components/kit/components/button";
import { CARD, cn } from "@/components/kit/tokens";
import type { HouseholdHome, NamedRef } from "@/types/families";

type HomeCardProps = {
  home: HouseholdHome;
  owners: NamedRef[];
  isNew: boolean;
  onOpenOwner: (guardianId: string) => void;
  onEdit: () => void;
  onArchive: () => void;
};

export default function HomeCard({
  home,
  owners,
  isNew,
  onOpenOwner,
  onEdit,
  onArchive,
}: HomeCardProps): ReactNode {
  return (
    <li
      className={cn(
        CARD,
        "flex items-start gap-3 py-2 pr-2 pl-4",
        isNew && "kit-rise",
      )}
    >
      <MapPin aria-hidden className="mt-3 size-4 shrink-0 text-(--tl-muted)" />
      <div className="min-w-0 flex-1 py-2">
        {home.label && (
          <p className="text-[13px] font-semibold text-(--tl-ink-soft)">
            {home.label}
          </p>
        )}
        <p className="text-[14px] leading-5 font-semibold">{home.address}</p>
        {home.directions && (
          <p className="mt-0.5 text-[13px] leading-[18px] text-(--tl-muted)">
            {home.directions}
          </p>
        )}
        {owners.length > 0 && (
          // The icon sits outside the wrap row, so a second line of names
          // lines up under the first, not under the icon.
          <div className="mt-1 flex items-start gap-1.5">
            {owners.length > 1 && (
              <Users
                aria-hidden
                className="mt-[5px] size-3.5 shrink-0 text-(--tl-muted)"
              />
            )}
            <div className="flex min-w-0 flex-wrap gap-x-3">
              {owners.map((owner) => (
                <TextLink
                  key={owner.id}
                  onClick={() => onOpenOwner(owner.id)}
                  className="text-left text-[13px]"
                >
                  {owner.name}
                </TextLink>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        <IconButton icon={Pencil} label={`Edit ${home.address}`} onClick={onEdit} />
        <IconButton
          icon={Archive}
          label={`Archive ${home.address}`}
          onClick={onArchive}
        />
      </div>
    </li>
  );
}
