// A family's overview, one scrolling page: Children first, then their
// Bookings week by week, then Guardians and Homes. A family isn't stored: it's the
// household holding the Guardian the page was opened from, recomputed
// on every render so new links show at once.
import { useState } from "react";
import type { ReactNode } from "react";
import { ArrowLeft, CalendarPlus } from "lucide-react";
import { TextLink } from "@/components/kit/components/button";
import { PageHeader } from "@/components/kit/shell/page-header";
import { useToast } from "@/components/kit/overlays/use-toast";
import FamilyChildren from "@/pages/prototype/accounts-staff/components/family-children";
import FamilyPeople from "@/pages/prototype/accounts-staff/components/family-people";
import AddGuardianSheet from "@/pages/prototype/accounts-staff/components/add-guardian-sheet";
import AddHomeSheet from "@/pages/prototype/accounts-staff/components/add-home-sheet";
import BookingDetails from "@/pages/prototype/accounts-staff/components/booking-details";
import FamilyWeek from "@/pages/prototype/accounts-staff/components/family-week";
import { AddChildSheet } from "@/pages/prototype/accounts-staff/components/guardian-sheets";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import { getFamilyTitle } from "@/pages/prototype/accounts-staff/lib/labels";
import {
  findHousehold,
  listChildren,
  listClients,
  listHouseholdHomes,
  readBooking,
} from "@/pages/prototype/accounts-staff/lib/mock-api";
import { getChildTones } from "@/components/kit/lib/child-tones";

type FamilyPageProps = {
  anchorGuardianId: string;
  onBack: () => void;
  onOpenChild: (id: string) => void;
  onOpenGuardian: (id: string) => void;
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export default function FamilyPage({
  anchorGuardianId,
  onBack,
  onOpenChild,
  onOpenGuardian,
}: FamilyPageProps): ReactNode {
  const { db, addChild } = useArea();
  const { showToast } = useToast();
  const [adding, setAdding] = useState<"child" | "guardian" | "home" | null>(null);
  const [openBookingId, setOpenBookingId] = useState<string | null>(null);
  const household = findHousehold(db, anchorGuardianId);
  if (!household) return null;

  const guardianIds = household.guardians.map((guardian) => guardian.id);
  const childIds = household.children.map((child) => child.id);
  const guardians = [...listClients(db, false), ...listClients(db, true)].filter((g) => guardianIds.includes(g.id));
  const children = [...listChildren(db, false), ...listChildren(db, true)].filter((c) => childIds.includes(c.id));
  const homes = listHouseholdHomes(db, household);
  const liveGuardians = guardians.filter((guardian) => !guardian.archived);
  const title = getFamilyTitle(household.guardians, household.children);
  const tones = getChildTones(childIds);
  const openBooking = openBookingId ? readBooking(db, openBookingId) : null;

  return (
    <>
      <PageHeader
        eyebrow={
          <TextLink onClick={onBack} className="-ml-1 text-[14px]">
            <ArrowLeft aria-hidden className="size-4" />
            Families
          </TextLink>
        }
        title={title}
        description={`${plural(children.filter((c) => !c.archived).length, "Child", "Children")} · ${plural(liveGuardians.length, "Guardian", "Guardians")} · ${plural(homes.filter((h) => !h.archived).length, "Home", "Homes")}`}
        primaryAction={{
          label: "New booking",
          icon: CalendarPlus,
          onClick: () => showToast({ tone: "info", message: "Opens the Bookings form with this family’s Children to pick from." }),
        }}
      />
      <div className="flex flex-col gap-10">
        <FamilyChildren
          items={children}
          canAdd={liveGuardians.length > 0}
          onAdd={() => setAdding("child")}
          tones={tones}
          onOpen={onOpenChild}
        />
        <FamilyWeek
          childRefs={household.children}
          tones={tones}
          onOpenBooking={setOpenBookingId}
        />
        <FamilyPeople
          guardians={guardians}
          homes={homes}
          onOpenGuardian={onOpenGuardian}
          onAddGuardian={() => setAdding("guardian")}
          onAddHome={() => setAdding("home")}
        />
      </div>
      {openBooking && (
        <BookingDetails booking={openBooking} backLabel={title} onClose={() => setOpenBookingId(null)} />
      )}
      {adding === "guardian" && (
        <AddGuardianSheet
          childRefs={household.children.filter((child) => !child.archived)}
          shareableHomes={homes.filter((home) => !home.archived)}
          onClose={() => setAdding(null)}
          onCreated={() => setAdding(null)}
        />
      )}
      {adding === "home" && (
        <AddHomeSheet guardians={liveGuardians} onClose={() => setAdding(null)} />
      )}
      {adding === "child" && (
        <AddChildSheet
          // Placeholder: link to every live Guardian in the family.
          guardians={liveGuardians}
          onClose={() => setAdding(null)}
          onSave={(input) => {
            addChild(input);
            setAdding(null);
            showToast({ tone: "success", message: `${input.name} added to the family.` });
          }}
        />
      )}
    </>
  );
}
