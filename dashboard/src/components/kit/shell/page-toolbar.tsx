// Search + filter dropdowns + view switch under the page header. The
// filters are MultiSelectFilters, one per field; "Clear all" shows once
// any is on. From 768px they wrap inline after the search; on phones the
// search takes its own row and the dropdowns scroll sideways below it.
import type { ReactNode } from "react";
import { TextLink } from "@/components/kit/components/button";
import { SearchInput } from "@/components/kit/components/fields";

type PageToolbarProps = {
  searchLabel: string;
  searchPlaceholder: string;
  query: string;
  onQueryChange: (query: string) => void;
  filters?: ReactNode;
  activeFilterCount?: number;
  onClearFilters?: () => void;
  view?: ReactNode;
  // False hides the search where it doesn't apply (Bookings' Needs attention).
  hasSearch?: boolean;
};

export function PageToolbar({
  searchLabel,
  searchPlaceholder,
  query,
  onQueryChange,
  filters,
  activeFilterCount = 0,
  onClearFilters,
  view,
  hasSearch = true,
}: PageToolbarProps): ReactNode {
  return (
    <div className="flex flex-col gap-3 @3xl:flex-row @3xl:flex-wrap @3xl:items-center">
      {hasSearch && (
        <SearchInput
          label={searchLabel}
          placeholder={searchPlaceholder}
          value={query}
          onChange={onQueryChange}
          className="@3xl:w-[300px]"
        />
      )}
      {filters && (
        <div
          role="group"
          aria-label="Filters"
          className="kit-no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 @2xl:mx-0 @2xl:flex-wrap @2xl:overflow-visible @2xl:px-0"
        >
          {filters}
          {activeFilterCount > 0 && onClearFilters && (
            <TextLink onClick={onClearFilters} className="ml-1 shrink-0 px-2">
              Clear all
            </TextLink>
          )}
        </div>
      )}
      {view && <div className="@3xl:ml-auto">{view}</div>}
    </div>
  );
}
