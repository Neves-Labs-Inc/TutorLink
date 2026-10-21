// Child details over the family page. Minimal for now (name, Archived,
// loading, error, not in this family); ticket 06 fills it in and keeps
// these props. Open other records with useFamilyDetails().
import type { ReactNode } from "react";
import { ArchivedBadge } from "@/components/kit/components/badges";
import { DetailOverlay } from "@/components/kit/overlays/detail-overlay";
import { InlineError } from "@/components/kit/states/states";
import type { Family } from "@/hooks/use-family";
import { errorStatus } from "@/lib/api";
import {
  DetailsHeaderSkeleton,
  DetailsIdentity,
  DetailsSkeleton,
} from "@/pages/families/components/details-states";
import { SUNK_WELL } from "@/pages/families/lib/family-classes";

const NOT_FOUND = 404;

type ChildDetailsOverlayProps = {
  childId: string;
  family: Family;
  isOpen: boolean;
  backLabel: string;
  onBack: () => void;
  onClose: () => void;
};

export default function ChildDetailsOverlay({
  childId,
  family,
  isOpen,
  backLabel,
  onBack,
  onClose,
}: ChildDetailsOverlayProps): ReactNode {
  const member = family.children.find((child) => child.id === childId);
  const detail = member?.detail;
  const child = detail?.data;
  const isNotInFamily =
    (family.household.isSuccess && !member) ||
    errorStatus(detail?.error) === NOT_FOUND;
  const hasFailed = !child && !isNotInFamily && detail?.isError === true;

  let header: ReactNode = <span />;
  let body: ReactNode = <DetailsSkeleton label="Loading Child details" />;
  if (child) {
    header = child.archived ? <ArchivedBadge /> : <span />;
    body = <DetailsIdentity name={child.name} />;
  } else if (isNotInFamily) {
    body = <p className={SUNK_WELL}>This Child isn’t in this family.</p>;
  } else if (hasFailed) {
    body = (
      <InlineError
        message="Couldn’t load Child details. Check your connection."
        onRetry={() => void detail.refetch()}
        isRetrying={detail.isFetching}
      />
    );
  } else {
    header = <DetailsHeaderSkeleton />;
  }

  return (
    <DetailOverlay
      isOpen={isOpen}
      onClose={onClose}
      onBack={onBack}
      title={child?.name ?? "Child details"}
      backLabel={backLabel}
      phoneMode="page"
      header={<div className="flex min-h-11 items-center justify-between gap-2">{header}</div>}
    >
      {body}
    </DetailOverlay>
  );
}
