// One family: the household plus every member's details, fetched in
// parallel once the household names them. Each member carries its own
// query, so a section can show one Child failing while the rest load.
import { useQueries, useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { familyQueries } from "@/lib/queries/families";
import type {
  ChildDetail,
  ClientRead,
  HouseholdChild,
  HouseholdGuardian,
  HouseholdRead,
} from "@/types/families";

export type FamilyChild = HouseholdChild & {
  detail: UseQueryResult<ChildDetail>;
};

export type FamilyGuardian = HouseholdGuardian & {
  detail: UseQueryResult<ClientRead>;
};

export type Family = {
  household: UseQueryResult<HouseholdRead>;
  // In the household's order; empty until it loads.
  children: FamilyChild[];
  guardians: FamilyGuardian[];
};

export function useFamily(memberId: string): Family {
  const household = useQuery(familyQueries.household(memberId));
  const householdChildren = household.data?.children ?? [];
  const householdGuardians = household.data?.guardians ?? [];
  const childDetails = useQueries({
    queries: householdChildren.map((child) => familyQueries.child(child.id)),
  });
  const guardianDetails = useQueries({
    queries: householdGuardians.map((guardian) =>
      familyQueries.guardian(guardian.id),
    ),
  });

  return {
    household,
    children: householdChildren.map((child, index) => ({
      ...child,
      detail: childDetails[index],
    })),
    guardians: householdGuardians.map((guardian, index) => ({
      ...guardian,
      detail: guardianDetails[index],
    })),
  };
}
