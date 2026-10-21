// Guardian details over the family page. Minimal for now (name,
// Archived, loading, error, not in this family); ticket 08 fills it in
// and keeps these props. Open other records with useFamilyDetails().
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

type GuardianDetailsOverlayProps = {
  guardianId: string;
  family: Family;
  isOpen: boolean;
  backLabel: string;
  onBack: () => void;
  onClose: () => void;
};

export default function GuardianDetailsOverlay({
  guardianId,
  family,
  isOpen,
  backLabel,
  onBack,
  onClose,
}: GuardianDetailsOverlayProps): ReactNode {
  const member = family.guardians.find((guardian) => guardian.id === guardianId);
  const detail = member?.detail;
  const guardian = detail?.data;
  const isNotInFamily =
    (family.household.isSuccess && !member) ||
    errorStatus(detail?.error) === NOT_FOUND;
  const hasFailed = !guardian && !isNotInFamily && detail?.isError === true;

  let header: ReactNode = <span />;
  let body: ReactNode = <DetailsSkeleton label="Loading Guardian details" />;
  if (guardian) {
    header = guardian.archived ? <ArchivedBadge /> : <span />;
    body = <DetailsIdentity name={guardian.name} />;
  } else if (isNotInFamily) {
    body = <p className={SUNK_WELL}>This Guardian isn’t in this family.</p>;
  } else if (hasFailed) {
    body = (
      <InlineError
        message="Couldn’t load Guardian details. Check your connection."
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
      title={guardian?.name ?? "Guardian details"}
      backLabel={backLabel}
      phoneMode="page"
      header={<div className="flex min-h-11 items-center justify-between gap-2">{header}</div>}
    >
      {body}
    </DetailOverlay>
  );
}
