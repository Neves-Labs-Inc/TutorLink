// The Child filter's options: the Children named in ?child=, by name
// (GET /api/children/{id}). An id still loading, or gone, shows as "Child".
import { useQueries } from "@tanstack/react-query";
import type { FilterOption } from "@/components/kit/components/multi-select-filter";
import { childQueries } from "@/lib/queries/children";

const UNNAMED = "Child";

export function useChildOptions(childIds: string[]): FilterOption[] {
  const children = useQueries({
    queries: childIds.map((id) => childQueries.detail(id)),
  });
  return childIds.map((id, index) => ({
    value: id,
    label: children[index]?.data?.name ?? UNNAMED,
  }));
}
