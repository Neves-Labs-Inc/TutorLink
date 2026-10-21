// /families: every family, the Guardians linked through shared Children,
// with search, archived families on request and 50 per page. A row opens
// the family's page.
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Archive, Baby, BookUser, SearchX, UserPlus } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import { Pager } from "@/components/kit/components/pager";
import { QuickFilter } from "@/components/kit/components/quick-filter";
import { pluralize } from "@/components/kit/format";
import { PageHeader } from "@/components/kit/shell/page-header";
import { PageToolbar } from "@/components/kit/shell/page-toolbar";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/kit/states/states";
import { FAMILIES_PAGE_SIZE } from "@/lib/queries/families";
import { familyPath } from "@/lib/families/family-paths";
import FamiliesTable from "@/pages/families/components/families-table";
import { useFamiliesList } from "@/pages/families/hooks/use-families-list";

const SKELETON_ROWS = 6;

// Disabled until the add flows (ticket 09) land; no handler on purpose.
const ADD_BUTTONS = (
  <>
    <Button icon={UserPlus} disabled>
      Add guardian
    </Button>
    <Button variant="primary" icon={Baby} disabled>
      Add child
    </Button>
  </>
);

export default function FamiliesPage(): ReactNode {
  const navigate = useNavigate();
  const list = useFamiliesList();
  const { result } = list;
  const data = result.data;
  // v5 puts a failed query back to pending while it retries; the error
  // stays up meanwhile.
  const hasFailed = !data && (result.isError || result.errorUpdateCount > 0);

  let body: ReactNode;
  if (hasFailed) {
    body = (
      <ErrorState
        title="Couldn’t load families"
        body="Check your connection and try again."
        onRetry={() => void result.refetch()}
        isRetrying={result.isFetching}
      />
    );
  } else if (!data || list.isOutOfRange || (result.isPlaceholderData && data.items.length === 0)) {
    // An empty page from the previous query says nothing about this one.
    body = <TableSkeleton columns={4} rows={SKELETON_ROWS} label="Loading families" />;
  } else if (data.items.length === 0 && list.isFiltered) {
    body = (
      <EmptyState
        icon={SearchX}
        title="No families match"
        body="Try a Child’s or Guardian’s name, or a phone number."
      />
    );
  } else if (data.items.length === 0) {
    body = (
      <EmptyState
        icon={BookUser}
        title="No families yet"
        body="They appear here once the bot or the office adds a Guardian."
      />
    );
  } else {
    body = (
      <>
        <FamiliesTable
          families={data.items}
          onOpen={(family) => navigate(familyPath(family.key))}
        />
        <div className="mt-4">
          <Pager
            page={list.pagerPage}
            pageSize={FAMILIES_PAGE_SIZE}
            total={list.pagerTotal}
            onPageChange={list.setPage}
            label="Families pages"
            isDisabled={result.isFetching}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Families"
        description={
          data ? (
            <span aria-live="polite">
              {pluralize(data.total, "family", "families")}
            </span>
          ) : undefined
        }
        secondaryActions={ADD_BUTTONS}
      >
        <div className="grid grid-cols-2 gap-2 @3xl:hidden">{ADD_BUTTONS}</div>
        <PageToolbar
          searchLabel="Search families"
          searchPlaceholder="Child, Guardian or phone"
          query={list.query}
          onQueryChange={list.setQuery}
          filters={
            <QuickFilter
              label="Show archived"
              icon={Archive}
              isOn={list.isArchivedShown}
              onToggle={list.toggleArchived}
            />
          }
        />
      </PageHeader>
      {body}
    </>
  );
}
