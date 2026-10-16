// The Families list: GET /api/households?q= plus, per family, what the
// row shows that the household shape lacks (Homes, next booking), which
// today means more reads per row (see report: API gaps).
import { useState } from "react";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import { getFamilyTitle } from "@/pages/prototype/accounts-staff/lib/labels";
import {
  listChildren,
  listHouseholdHomes,
  listHouseholds,
} from "@/pages/prototype/accounts-staff/lib/mock-api";
import type {
  HouseholdRead,
  NextSession,
} from "@/pages/prototype/accounts-staff/types/api";

export type FamilyRow = {
  key: string;
  title: string;
  household: HouseholdRead;
  homeCount: number;
  nextSession: NextSession | null;
  isArchived: boolean;
};

type FamiliesList = {
  query: string;
  setQuery: (query: string) => void;
  isArchived: boolean;
  setIsArchived: (isArchived: boolean) => void;
  rows: FamilyRow[];
  totals: { families: number; children: number; guardians: number };
  isNarrowed: boolean;
};

function getEarliest(sessions: (NextSession | null)[]): NextSession | null {
  const live = sessions.filter((session): session is NextSession => session !== null);
  live.sort(
    (a, b) =>
      a.scheduled_date.localeCompare(b.scheduled_date) ||
      a.start_time.localeCompare(b.start_time),
  );
  return live[0] ?? null;
}

export function useFamiliesList(): FamiliesList {
  const { db } = useArea();
  const [query, setQuery] = useState("");
  const [isArchived, setIsArchived] = useState(false);
  const childSummaries = listChildren(db, false);

  function toRow(household: HouseholdRead): FamilyRow {
    const childIds = household.children.map((child) => child.id);
    return {
      key: household.key,
      title: getFamilyTitle(household.guardians, household.children),
      household,
      homeCount: listHouseholdHomes(db, household).filter((home) => !home.archived).length,
      nextSession: getEarliest(
        childSummaries.filter((child) => childIds.includes(child.id)).map((child) => child.next_session),
      ),
      // A family is archived only once every Guardian in it is.
      isArchived:
        household.guardians.length > 0
          ? household.guardians.every((guardian) => guardian.archived)
          : household.children.every((child) => child.archived),
    };
  }

  const all = listHouseholds(db).map(toRow);
  const rows = listHouseholds(db, query)
    .map(toRow)
    .filter((row) => row.isArchived === isArchived);
  const live = all.filter((row) => !row.isArchived);

  return {
    query,
    setQuery,
    isArchived,
    setIsArchived,
    rows,
    totals: {
      families: live.length,
      children: live.reduce((total, row) => total + row.household.children.filter((c) => !c.archived).length, 0),
      guardians: live.reduce((total, row) => total + row.household.guardians.filter((g) => !g.archived).length, 0),
    },
    isNarrowed: query.trim() !== "",
  };
}
