// Guardians and Homes, side by side from 1024px kit width (Guardians
// left), stacked below. grid-cols-1 is minmax(0, 1fr): without it the
// implicit track grows to the cards' min-content and overflows phones.
import type { ReactNode } from "react";
import type { Family } from "@/hooks/use-family";
import FamilyGuardians from "@/pages/families/components/family-guardians";
import FamilyHomes from "@/pages/families/components/family-homes";

type FamilyPeopleSectionProps = { family: Family };

export default function FamilyPeopleSection({
  family,
}: FamilyPeopleSectionProps): ReactNode {
  return (
    <div className="grid grid-cols-1 gap-8 @5xl:grid-cols-2 @5xl:gap-6">
      <FamilyGuardians family={family} />
      <FamilyHomes family={family} />
    </div>
  );
}
