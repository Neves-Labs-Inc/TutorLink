// The family's Children as cards (archived ones too, muted) and Add
// child. A card opens the Child's details over the page.
import { useState } from "react";
import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import { getChildTones } from "@/components/kit/lib/child-tones";
import { EYEBROW } from "@/components/kit/tokens";
import type { Family } from "@/hooks/use-family";
import AddChildSheet from "@/pages/families/components/add-child-sheet";
import ChildCard from "@/pages/families/components/child-card";
import { useFamilyDetails } from "@/pages/families/hooks/use-family-details";
import { SECTION_HEAD, SUNK_WELL } from "@/pages/families/lib/family-classes";

const HEADING_ID = "family-children";
// A lone Child needs no colour to tell it from a sibling.
const MIN_CHILDREN_FOR_DOTS = 2;

type FamilyChildrenSectionProps = { family: Family };

export default function FamilyChildrenSection({
  family,
}: FamilyChildrenSectionProps): ReactNode {
  const { openChild } = useFamilyDetails();
  const [isAdding, setIsAdding] = useState(false);
  // The card the sheet just created rises in once.
  const [addedId, setAddedId] = useState<string | null>(null);
  const tones = getChildTones(family.children.map((child) => child.id));
  const hasDots = family.children.length >= MIN_CHILDREN_FOR_DOTS;
  const liveCount = family.children.filter((child) => !child.archived).length;
  const liveGuardians = family.guardians.filter(
    (guardian) => !guardian.archived,
  );

  return (
    <section aria-labelledby={HEADING_ID}>
      <div className={SECTION_HEAD}>
        <h2 id={HEADING_ID} className={EYEBROW}>
          Children · {liveCount} live
        </h2>
        {liveGuardians.length > 0 && (
          <Button variant="soft" icon={Plus} onClick={() => setIsAdding(true)}>
            Add child
          </Button>
        )}
      </div>
      {family.children.length === 0 ? (
        <p className={SUNK_WELL}>No Children yet</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 @3xl:grid-cols-2">
          {family.children.map((child) => (
            <li key={child.id}>
              <ChildCard
                child={child}
                tone={hasDots ? (tones.get(child.id) ?? null) : null}
                isNew={child.id === addedId}
                onOpen={() => openChild(child.id)}
              />
            </li>
          ))}
        </ul>
      )}
      <AddChildSheet
        isOpen={isAdding}
        liveGuardians={liveGuardians}
        onClose={() => setIsAdding(false)}
        onAdded={(child) => {
          setAddedId(child.id);
          setIsAdding(false);
        }}
      />
    </section>
  );
}
