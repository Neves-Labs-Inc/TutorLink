import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { CircleDot } from "lucide-react";
import { MultiSelectFilter } from "@/components/kit/components/multi-select-filter";
import type { FilterOption } from "@/components/kit/components/multi-select-filter";
import { QuickFilter } from "@/components/kit/components/quick-filter";
import { PageToolbar } from "@/components/kit/shell/page-toolbar";
import { useConversationFilters } from "@/pages/chats/use-conversation-filters";

const SEARCH_DEBOUNCE_MS = 300;

const WITH_OPTIONS: FilterOption[] = [
  { value: "bot", label: "Bot" },
  { value: "mine", label: "Taken over by you" },
  { value: "others", label: "Taken over by others" },
];

// Search, Unread and With over the Conversations list. The state is in
// the URL; the search box keeps its own text and writes it after a pause.
export function ConversationsToolbar(): ReactNode {
  const {
    filters,
    activeFilterCount,
    setQuery,
    toggleUnread,
    setHolders,
    clearFilters,
  } = useConversationFilters();
  const [searchText, setSearchText] = useState(filters.q);
  const [syncedQuery, setSyncedQuery] = useState(filters.q);
  // The q this box last wrote. The router applies URL changes in a
  // transition, so it lands later; its arrival must not overwrite the box.
  const [writtenQuery, setWrittenQuery] = useState<string | null>(null);

  // The URL's search changed under the box (back, a link): show it.
  if (filters.q !== syncedQuery) {
    setSyncedQuery(filters.q);
    setWrittenQuery(null);
    if (filters.q !== writtenQuery) setSearchText(filters.q);
  }

  useEffect(() => {
    if (searchText === (writtenQuery ?? syncedQuery)) return;
    const timer = setTimeout(() => {
      setWrittenQuery(searchText);
      setQuery(searchText);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText, syncedQuery, writtenQuery, setQuery]);

  return (
    <PageToolbar
      searchLabel="Search chats"
      searchPlaceholder="Search a Guardian or number"
      query={searchText}
      onQueryChange={setSearchText}
      activeFilterCount={activeFilterCount}
      onClearFilters={clearFilters}
      filters={
        <>
          <QuickFilter
            label="Unread"
            icon={CircleDot}
            isOn={filters.isUnread}
            onToggle={toggleUnread}
          />
          <MultiSelectFilter
            label="With"
            options={WITH_OPTIONS}
            selected={filters.holders}
            onChange={setHolders}
          />
        </>
      }
    />
  );
}
