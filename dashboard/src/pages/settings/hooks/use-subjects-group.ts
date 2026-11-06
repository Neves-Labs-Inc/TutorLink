// The Subjects group's state: which list (Active or Archived) and page
// is showing, its query, and which sheet is open. Keeps no Settings
// form state, so it works on any page.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { subjectQueries } from "@/lib/queries/subjects";
import type { Subject } from "@/lib/queries/subjects";

export const SUBJECT_PAGE_SIZE = 20;

export type SubjectTab = "active" | "archived";

type SheetState = {
  isOpen: boolean;
  // null adds a new Subject.
  subject: Subject | null;
  // Bumped on every open, so the sheet's form starts fresh.
  key: number;
};

// The list key's third part is the params object.
function isSameTab(params: unknown, isArchived: boolean): boolean {
  return (
    typeof params === "object" &&
    params !== null &&
    "archived" in params &&
    params.archived === isArchived
  );
}

export function useSubjectsGroup() {
  const [tab, setTab] = useState<SubjectTab>("active");
  const [page, setPage] = useState(1);
  const [sheet, setSheet] = useState<SheetState>({
    isOpen: false,
    subject: null,
    key: 0,
  });

  const isArchivedTab = tab === "archived";
  const query = useQuery({
    ...subjectQueries.list({
      archived: isArchivedTab,
      page,
      page_size: SUBJECT_PAGE_SIZE,
    }),
    // Keep rows across page changes, but never show the other tab's.
    placeholderData: (previous, previousQuery) =>
      isSameTab(previousQuery?.queryKey[2], isArchivedTab)
        ? previous
        : undefined,
  });

  function changeTab(next: SubjectTab): void {
    setTab(next);
    setPage(1);
  }

  function openSheet(subject: Subject | null): void {
    setSheet((current) => ({
      isOpen: true,
      subject,
      key: current.key + 1,
    }));
  }

  function closeSheet(): void {
    setSheet((current) => ({ ...current, isOpen: false }));
  }

  // A new Subject is active, so show where it landed.
  function handleAdded(): void {
    changeTab("active");
  }

  return {
    tab,
    page,
    sheet,
    isArchivedTab,
    subjects: query.data?.items ?? null,
    total: query.data?.total ?? 0,
    isLoading: query.data === undefined && !query.isError,
    isFailed: query.data === undefined && query.isError,
    isRetrying: query.isFetching,
    isPageLoading: query.isPlaceholderData,
    retry: () => void query.refetch(),
    changeTab,
    changePage: setPage,
    openSheet,
    closeSheet,
    handleAdded,
  };
}
