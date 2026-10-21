// Staff › Children's list: the Evaluated Children (archived ones
// included) this Staff member is an Assigned Tutor of.
import { useQuery } from "@tanstack/react-query";
import { assignedChildrenQueries } from "@/lib/queries/assigned-children";
import type { EvaluatedChild } from "@/lib/queries/assigned-children";
import type { StaffRead } from "@/lib/queries/staff";
import { isAssignedTo } from "@/pages/staff/lib/assigned-children";

type AssignedChildren = {
  // Undefined until the first load.
  children: EvaluatedChild[] | undefined;
  liveCount: number;
  hasFailed: boolean;
  isRetrying: boolean;
  retry: () => void;
};

export function useAssignedChildren(staff: StaffRead): AssignedChildren {
  const query = useQuery(assignedChildrenQueries.evaluated());
  const children = query.data?.filter((child) => isAssignedTo(child, staff.id));
  // Staff details already has the count; it fills in until the list loads.
  const liveCount = children
    ? children.filter((child) => !child.archived).length
    : staff.assigned_children.length;

  return {
    children,
    liveCount,
    // v5 resets a failed query to pending while it retries; the error stays up meanwhile.
    hasFailed: !children && (query.isError || query.errorUpdateCount > 0),
    isRetrying: query.isFetching,
    retry: () => void query.refetch(),
  };
}
