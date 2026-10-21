// The family's Guardians (archived ones too, muted) and Add guardian.
// A row opens the Guardian's details over the page.
import { useState } from "react";
import type { ReactNode } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import { EYEBROW } from "@/components/kit/tokens";
import type { Family } from "@/hooks/use-family";
import AddGuardianSheet from "@/pages/families/components/add-guardian-sheet";
import GuardianRow from "@/pages/families/components/guardian-row";
import { useFamilyDetails } from "@/pages/families/hooks/use-family-details";
import { SECTION_HEAD, SUNK_WELL } from "@/pages/families/lib/family-classes";

const HEADING_ID = "family-guardians";

type FamilyGuardiansProps = { family: Family };

export default function FamilyGuardians({
  family,
}: FamilyGuardiansProps): ReactNode {
  const { openGuardian } = useFamilyDetails();
  const [isAdding, setIsAdding] = useState(false);
  // The row the sheet just created rises in once.
  const [addedId, setAddedId] = useState<string | null>(null);
  const liveChildren = family.children.filter((child) => !child.archived);
  const liveHomes = (family.household.data?.homes ?? []).filter(
    (home) => !home.archived,
  );

  return (
    <section aria-labelledby={HEADING_ID}>
      <div className={SECTION_HEAD}>
        <h2 id={HEADING_ID} className={EYEBROW}>
          Guardians · {family.guardians.length}
        </h2>
        <Button variant="soft" icon={UserPlus} onClick={() => setIsAdding(true)}>
          Add guardian
        </Button>
      </div>
      {family.guardians.length === 0 ? (
        <p className={SUNK_WELL}>No Guardians yet</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {family.guardians.map((guardian) => (
            <GuardianRow
              key={guardian.id}
              guardian={guardian}
              isNew={guardian.id === addedId}
              onOpen={() => openGuardian(guardian.id)}
            />
          ))}
        </ul>
      )}
      <AddGuardianSheet
        isOpen={isAdding}
        mode="family"
        familyChildren={liveChildren}
        familyHomes={liveHomes}
        onClose={() => setIsAdding(false)}
        onAdded={(guardian) => {
          setAddedId(guardian.id);
          setIsAdding(false);
        }}
      />
    </section>
  );
}
