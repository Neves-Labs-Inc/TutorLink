// Opens Child and Guardian details on the family page. Use this, not a
// plain link, from inside the page: it pushes one history entry per open
// so Back and browser back pop one level. Other pages link in with
// familyChildPath / familyGuardianPath instead.
import { useLocation, useNavigate } from "react-router-dom";
import {
  readDetailsStack,
  resolveDetailsStack,
} from "@/lib/families/details-stack";
import type { DetailsStackState } from "@/lib/families/details-stack";
import { readDetailEntry, withDetailEntry } from "@/lib/families/family-paths";
import type { DetailEntry } from "@/lib/families/family-paths";

export type FamilyDetails = {
  // Bottom to top; the top one is in the URL.
  stack: DetailEntry[];
  isDeepLink: boolean;
  openChild: (childId: string) => void;
  openGuardian: (guardianId: string) => void;
  // Pops the top record.
  back: () => void;
  // Closes every record.
  close: () => void;
};

export function useFamilyDetails(): FamilyDetails {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const { stack, isDeepLink } = resolveDetailsStack(
    readDetailEntry(params),
    readDetailsStack(location.state),
  );

  function open(entry: DetailEntry): void {
    const state: DetailsStackState = { familyDetails: [...stack, entry] };
    navigate({ search: withDetailEntry(params, entry) }, { state });
  }

  return {
    stack,
    isDeepLink,
    openChild: (childId) => open({ kind: "child", id: childId }),
    openGuardian: (guardianId) => open({ kind: "guardian", id: guardianId }),
    // Every entry was pushed (the host turns a deep link into a push
    // too), so stepping back through history pops exactly the stack.
    back: () => {
      if (stack.length > 0) navigate(-1);
    },
    close: () => {
      if (stack.length > 0) navigate(-stack.length);
    },
  };
}
