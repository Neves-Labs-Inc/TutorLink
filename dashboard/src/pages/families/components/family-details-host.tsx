// Maps the family page's URL to its details overlays: one overlay per
// stack entry, each pushed over the one below (both z-50, ordered by
// mount). A popped entry stays mounted, closed, so it plays its exit.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Family } from "@/hooks/use-family";
import { isSameEntry, keepClosingSlots } from "@/lib/families/details-stack";
import type { DetailsStackState } from "@/lib/families/details-stack";
import { withDetailEntry } from "@/lib/families/family-paths";
import type { DetailEntry } from "@/lib/families/family-paths";
import ChildDetailsOverlay from "@/pages/families/components/child-details-overlay";
import GuardianDetailsOverlay from "@/pages/families/components/guardian-details-overlay";
import { useFamilyDetails } from "@/pages/families/hooks/use-family-details";

// Before the household loads, Back has no family name to show.
const FALLBACK_BACK_LABEL = "Back";

function getEntryName(family: Family, entry: DetailEntry): string | null {
  const members = entry.kind === "child" ? family.children : family.guardians;
  return members.find((member) => member.id === entry.id)?.name ?? null;
}

type FamilyDetailsHostProps = { family: Family };

export default function FamilyDetailsHost({
  family,
}: FamilyDetailsHostProps): ReactNode {
  const details = useFamilyDetails();
  const { stack, isDeepLink } = details;
  const [slots, setSlots] = useState<DetailEntry[]>([]);
  const nextSlots = keepClosingSlots(slots, stack);
  const hasSlotsChanged =
    nextSlots.length !== slots.length ||
    nextSlots.some((entry, index) => !isSameEntry(slots[index], entry));
  if (hasSlotsChanged) setSlots(nextSlots);
  useSettleDeepLink(isDeepLink, stack);

  const familyName = family.household.data?.name ?? FALLBACK_BACK_LABEL;
  return nextSlots.map((entry, index) => {
    const below = nextSlots[index - 1];
    const shared = {
      family,
      isOpen: index < stack.length,
      backLabel: below ? (getEntryName(family, below) ?? familyName) : familyName,
      onBack: details.back,
      onClose: details.close,
    };
    // One instance per record, so state never carries over to another
    // record; a popped entry keeps its slot (and key) through its exit.
    const key = `${index}-${entry.kind}-${entry.id}`;
    return entry.kind === "child" ? (
      <ChildDetailsOverlay key={key} childId={entry.id} {...shared} />
    ) : (
      <GuardianDetailsOverlay key={key} guardianId={entry.id} {...shared} />
    );
  });
}

// A deep link opened the top record with nothing under it in history.
// Re-file it as the family page plus one pushed entry, so Back, Close and
// browser back all land on the family page, like an open from inside.
function useSettleDeepLink(isDeepLink: boolean, stack: DetailEntry[]): void {
  const location = useLocation();
  const navigate = useNavigate();
  // Once per history entry, even when effects run twice in development.
  const settledKey = useRef<string | null>(null);
  const top = stack.at(-1);

  useEffect(() => {
    if (!isDeepLink || !top || settledKey.current === location.key) return;

    settledKey.current = location.key;
    const params = new URLSearchParams(location.search);
    const state: DetailsStackState = { familyDetails: [top] };
    navigate({ search: withDetailEntry(params, null) }, { replace: true });
    navigate({ search: withDetailEntry(params, top) }, { state });
  }, [isDeepLink, top, location.key, location.search, navigate]);
}
