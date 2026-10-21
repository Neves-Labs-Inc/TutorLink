// The Families list's state: a debounced search, "Show archived" and the
// page, folded into one households query. Any change to the search or
// the filter starts again from page 1.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { useClampedPage } from "@/hooks/useClampedPage";
import { familyQueries } from "@/lib/queries/families";
import type { HouseholdListParams, HouseholdRead, Page } from "@/types/families";

const SEARCH_DEBOUNCE_MS = 300;

type FamiliesList = {
  query: string;
  setQuery: (query: string) => void;
  isArchivedShown: boolean;
  toggleArchived: () => void;
  isFiltered: boolean;
  setPage: (page: number) => void;
  pagerPage: number;
  pagerTotal: number;
  isOutOfRange: boolean;
  result: UseQueryResult<Page<HouseholdRead>>;
};

export function useFamiliesList(): FamiliesList {
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [isArchivedShown, setIsArchivedShown] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = query.trim();
      // Only a changed term moves the page, so a trailing space keeps it.
      setSearchTerm((current) => {
        if (current !== next) setPage(1);
        return next;
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const params: HouseholdListParams = {
    ...(searchTerm ? { q: searchTerm } : {}),
    ...(isArchivedShown ? { include_archived: true } : {}),
    page,
  };
  const result = useQuery(familyQueries.households(params));
  const clamped = useClampedPage({
    page,
    setPage,
    data: result.data,
    isPlaceholderData: result.isPlaceholderData,
    isFetching: result.isFetching,
  });

  function changePage(next: number): void {
    setPage(next);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document
      .querySelector("[data-kit-scroll]")
      ?.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }

  function toggleArchived(): void {
    setIsArchivedShown((current) => !current);
    setPage(1);
  }

  return {
    query,
    setQuery,
    isArchivedShown,
    toggleArchived,
    isFiltered: searchTerm !== "" || isArchivedShown,
    setPage: changePage,
    pagerPage: clamped.pagerPage,
    pagerTotal: clamped.pagerTotal,
    isOutOfRange: clamped.outOfRange,
    result,
  };
}
