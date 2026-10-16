// Families (CONTEXT.md: a Guardian's saved details, their Homes and
// their Children). Sub-page tabs Children | Guardians, each with its own
// search and filters. Details stack: Child ⇄ Guardian.
import { useState } from "react";
import type { ReactNode } from "react";
import { SearchX } from "lucide-react";
import {
  CHILDREN,
  GUARDIANS,
  getGuardiansOf,
} from "@/pages/prototype/shell-kit/kit/mock-data";
import type { Child, Guardian } from "@/pages/prototype/shell-kit/kit/mock-data";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import { SubPageTabs } from "@/pages/prototype/shell-kit/kit/components/tabs";
import { PageHeader } from "@/pages/prototype/shell-kit/kit/shell/page-header";
import { PageToolbar } from "@/pages/prototype/shell-kit/kit/shell/page-toolbar";
import { EmptyState } from "@/pages/prototype/shell-kit/kit/states/states";
import AccountDetails from "@/pages/prototype/shell-kit/screens/account-details";
import type { AccountEntry } from "@/pages/prototype/shell-kit/screens/account-details";
import FilterDropdowns from "@/pages/prototype/shell-kit/screens/filter-dropdowns";
import {
  ChildrenTable,
  GuardiansTable,
} from "@/pages/prototype/shell-kit/screens/people-tables";
import { useHomes } from "@/pages/prototype/shell-kit/screens/use-homes";
import {
  CHILD_FILTER_FIELDS,
  GUARDIAN_FILTER_FIELDS,
  useChildFilters,
  useGuardianFilters,
} from "@/pages/prototype/shell-kit/screens/use-record-filters";

type Tab = "children" | "guardians";

function includesAny(names: string[], query: string): boolean {
  const needle = query.trim().toLowerCase();
  return names.some((name) => name.toLowerCase().includes(needle));
}

// Search finds a Child by their own name or a Guardian's, and the other
// way round.
function matchesChild(child: Child, query: string): boolean {
  return includesAny([child.name, ...getGuardiansOf(child.name).map((g) => g.name)], query);
}

function matchesGuardian(guardian: Guardian, query: string): boolean {
  return includesAny([guardian.name, ...guardian.children], query);
}

export default function AccountsPage(): ReactNode {
  const [tab, setTab] = useState<Tab>("children");
  const [query, setQuery] = useState("");
  const [stack, setStack] = useState<AccountEntry[]>([]);
  const childFilters = useChildFilters();
  const guardianFilters = useGuardianFilters();
  const { homes } = useHomes();
  const isChildren = tab === "children";
  const filters = isChildren ? childFilters : guardianFilters;

  const childRows = childFilters.apply(CHILDREN).filter((child) => matchesChild(child, query));
  const guardianRows = guardianFilters
    .apply(GUARDIANS)
    .filter((guardian) => matchesGuardian(guardian, query));
  const rowCount = isChildren ? childRows.length : guardianRows.length;
  const awaiting = CHILDREN.filter((child) => !child.isEvaluated).length;

  function getHomeCount(guardian: Guardian): number {
    return homes.filter((home) => home.guardianId === guardian.id && !home.isArchived).length;
  }

  function handleClear(): void {
    setQuery("");
    filters.clearAll();
  }

  return (
    <>
      <PageHeader
        title="Families"
        description={`${CHILDREN.length} Children, ${awaiting} awaiting evaluation. ${GUARDIANS.length} Guardians.`}
        tabs={
          <SubPageTabs
            label="Families sections"
            activeId={tab}
            onChange={(id) => {
              // Ids come from the two items below.
              setTab(id as Tab);
              setQuery("");
            }}
            items={[
              { id: "children", label: "Children", count: CHILDREN.length },
              { id: "guardians", label: "Guardians", count: GUARDIANS.length },
            ]}
          />
        }
      >
        <PageToolbar
          searchLabel={isChildren ? "Search Children" : "Search Guardians"}
          searchPlaceholder="Search a Child or Guardian"
          query={query}
          onQueryChange={setQuery}
          activeFilterCount={filters.activeCount}
          onClearFilters={filters.clearAll}
          filters={
            isChildren ? (
              <FilterDropdowns
                fields={CHILD_FILTER_FIELDS}
                selected={childFilters.selected}
                onChange={childFilters.set}
              />
            ) : (
              <FilterDropdowns
                fields={GUARDIAN_FILTER_FIELDS}
                selected={guardianFilters.selected}
                onChange={guardianFilters.set}
              />
            )
          }
        />
      </PageHeader>
      {rowCount === 0 && (
        <EmptyState
          icon={SearchX}
          title={isChildren ? "No Children match" : "No Guardians match"}
          body="Try another name, or clear the filters."
          action={<Button onClick={handleClear}>Clear search and filters</Button>}
        />
      )}
      {isChildren && childRows.length > 0 && (
        <ChildrenTable
          rows={childRows}
          onOpen={(child) => setStack([{ kind: "child", id: child.id }])}
        />
      )}
      {!isChildren && guardianRows.length > 0 && (
        <GuardiansTable
          rows={guardianRows}
          getHomeCount={getHomeCount}
          onOpen={(guardian) => setStack([{ kind: "guardian", id: guardian.id }])}
        />
      )}
      <AccountDetails
        stack={stack}
        onChange={setStack}
        rootLabel={isChildren ? "Children" : "Guardians"}
      />
    </>
  );
}
