// The family's Homes, managed here: add, edit (fields and owners),
// archive and restore. Owner names open their Guardian's details.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { House } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import { ConfirmDialog, Dialog } from "@/components/kit/overlays/dialog";
import { EYEBROW } from "@/components/kit/tokens";
import type { Family } from "@/hooks/use-family";
import ArchivedHomes from "@/pages/families/components/archived-homes";
import HomeCard from "@/pages/families/components/home-card";
import HomeFormSheet from "@/pages/families/components/home-form-sheet";
import { useFamilyDetails } from "@/pages/families/hooks/use-family-details";
import { useHomeArchive } from "@/pages/families/hooks/use-home-archive";
import { SECTION_HEAD, SUNK_WELL } from "@/pages/families/lib/family-classes";
import type { HouseholdHome, NamedRef } from "@/types/families";

const HEADING_ID = "family-homes";
const NO_GUARDIAN_HINT_ID = "family-homes-no-guardian";
const ADD_HOME_ID = "family-add-home";

type FamilyHomesProps = { family: Family };

export default function FamilyHomes({ family }: FamilyHomesProps): ReactNode {
  const { openGuardian } = useFamilyDetails();
  const [isFormOpen, setIsFormOpen] = useState(false);
  // Kept while the sheet closes, so it doesn't flip to "Add home" mid-exit.
  const [formHome, setFormHome] = useState<HouseholdHome | null>(null);
  // The card a sheet added or Restore brought back rises in once.
  const [risenId, setRisenId] = useState<string | null>(null);
  // After an archive the card is gone; focus lands on Add home instead,
  // once the dialog has closed and let go of focus. (The kit Button
  // takes no ref.)
  const [archivedCount, setArchivedCount] = useState(0);
  useEffect(() => {
    if (archivedCount > 0) document.getElementById(ADD_HOME_ID)?.focus();
  }, [archivedCount]);
  const archive = useHomeArchive({
    onArchived: () => setArchivedCount((count) => count + 1),
    onRestored: setRisenId,
  });

  const homes = family.household.data?.homes ?? [];
  const liveHomes = homes.filter((home) => !home.archived);
  const archivedHomes = homes.filter((home) => home.archived);
  const liveGuardians: NamedRef[] = family.guardians.filter(
    (guardian) => !guardian.archived,
  );
  const canAddHome = liveGuardians.length > 0;
  const { confirming, blocked } = archive;
  const blockedCount = blocked?.bookingCount ?? 0;

  function getOwners(home: HouseholdHome): NamedRef[] {
    return family.guardians.filter((guardian) =>
      home.guardian_ids.includes(guardian.id),
    );
  }

  function openForm(home: HouseholdHome | null): void {
    setFormHome(home);
    setIsFormOpen(true);
  }

  return (
    <section aria-labelledby={HEADING_ID}>
      <div className={SECTION_HEAD}>
        <h2 id={HEADING_ID} className={EYEBROW}>
          Homes · {liveHomes.length} live
        </h2>
        <Button
          id={ADD_HOME_ID}
          variant="soft"
          icon={House}
          disabled={!canAddHome}
          aria-describedby={canAddHome ? undefined : NO_GUARDIAN_HINT_ID}
          onClick={() => openForm(null)}
        >
          Add home
        </Button>
      </div>
      {!canAddHome && (
        <p
          id={NO_GUARDIAN_HINT_ID}
          className="mb-2 px-1 text-[13px] text-(--tl-muted)"
        >
          A Home is saved on a Guardian. Add a Guardian first.
        </p>
      )}
      {liveHomes.length === 0 ? (
        <p className={SUNK_WELL}>No Homes yet. Bookings can still be In office.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {liveHomes.map((home) => (
            <HomeCard
              key={home.id}
              home={home}
              owners={getOwners(home)}
              isNew={home.id === risenId}
              onOpenOwner={openGuardian}
              onEdit={() => openForm(home)}
              onArchive={() => archive.askToArchive(home)}
            />
          ))}
        </ul>
      )}
      <ArchivedHomes
        homes={archivedHomes}
        restoringId={archive.restoringId}
        onRestore={archive.restore}
      />
      <HomeFormSheet
        isOpen={isFormOpen}
        home={formHome}
        liveGuardians={liveGuardians}
        onClose={() => setIsFormOpen(false)}
        onSaved={(homeId) => {
          if (!formHome) setRisenId(homeId);
          setIsFormOpen(false);
        }}
      />
      <ConfirmDialog
        isOpen={confirming !== null}
        onClose={archive.cancelArchive}
        onConfirm={archive.confirmArchive}
        title="Archive this Home?"
        confirmLabel="Archive home"
        keepLabel="Keep home"
        isDestructive
        isWorking={archive.isArchiving}
      >
        {confirming?.address} can’t be picked for new Bookings. Past Bookings
        keep it.
      </ConfirmDialog>
      <Dialog
        isOpen={blocked !== null}
        onClose={archive.dismissBlocked}
        title="This Home still has Bookings"
        footer={
          <Button variant="primary" onClick={archive.dismissBlocked}>
            Got it
          </Button>
        }
      >
        {blockedCount === 1
          ? `1 upcoming Booking is at ${blocked?.home.address}. Change it`
          : `${blockedCount} upcoming Bookings are at ${blocked?.home.address}. Change them`}{" "}
        to another Location in Bookings first, then archive the Home.
      </Dialog>
    </section>
  );
}
