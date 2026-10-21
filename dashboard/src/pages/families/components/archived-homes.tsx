// The "Archived · n" disclosure under the live Homes, each with Restore.
import type { ReactNode } from "react";
import { ArchiveRestore, ChevronDown } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import type { HouseholdHome } from "@/types/families";

type ArchivedHomesProps = {
  homes: HouseholdHome[];
  restoringId: string | null;
  onRestore: (home: HouseholdHome) => void;
};

export default function ArchivedHomes({
  homes,
  restoringId,
  onRestore,
}: ArchivedHomesProps): ReactNode {
  if (homes.length === 0) return null;

  return (
    <details className="group mt-3">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full px-1 text-[14px] font-semibold text-(--tl-link) transition-colors duration-150 hover:bg-(--tl-tint) [&::-webkit-details-marker]:hidden">
        <ChevronDown
          aria-hidden
          className="size-4 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
        />
        Archived · {homes.length}
      </summary>
      <ul className="mt-1 flex flex-col gap-2">
        {homes.map((home) => (
          <li
            key={home.id}
            className="flex items-center gap-3 rounded-[16px] bg-(--tl-surface-sunk) py-2 pr-2 pl-4 text-(--tl-muted)"
          >
            <span className="min-w-0 flex-1 text-[14px] leading-5">
              {home.address}
            </span>
            <Button
              variant="outline"
              icon={ArchiveRestore}
              isLoading={restoringId === home.id}
              onClick={() => onRestore(home)}
              aria-label={`Restore ${home.address}`}
            >
              Restore
            </Button>
          </li>
        ))}
      </ul>
    </details>
  );
}
