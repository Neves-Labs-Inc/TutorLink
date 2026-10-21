// /families/:memberId: one family's overview. Sections (03, 05, 04) fill
// themselves from useFamily; ?child= / ?guardian= open details over it.
import type { ReactNode } from "react";
import { useParams } from "react-router-dom";
import { PageHeader } from "@/components/kit/shell/page-header";
import { ErrorState } from "@/components/kit/states/states";
import { useFamily } from "@/hooks/use-family";
import { errorStatus } from "@/lib/api";
import FamiliesBackLink from "@/pages/families/components/families-back-link";
import FamilyChildrenSection from "@/pages/families/components/family-children-section";
import FamilyDetailsHost from "@/pages/families/components/family-details-host";
import FamilyPageSkeleton from "@/pages/families/components/family-page-skeleton";
import FamilyPeopleSection from "@/pages/families/components/family-people-section";
import FamilyWeekSection from "@/pages/families/components/family-week-section";
import { FAMILY_SECTIONS } from "@/pages/families/lib/family-classes";

const NOT_FOUND = 404;

export default function FamilyPage(): ReactNode {
  const { memberId = "" } = useParams();
  const family = useFamily(memberId);
  const { household } = family;
  const backLink = <FamiliesBackLink />;
  // v5 puts a failed query back to pending while it retries; the error
  // stays up meanwhile.
  const hasFailed =
    !household.data && (household.isError || household.errorUpdateCount > 0);
  const isNotFound = hasFailed && errorStatus(household.error) === NOT_FOUND;

  let content: ReactNode;
  if (household.data) {
    content = (
      <>
        <PageHeader eyebrow={backLink} title={household.data.name} />
        <div className={FAMILY_SECTIONS}>
          <FamilyChildrenSection family={family} />
          <FamilyWeekSection family={family} />
          <FamilyPeopleSection family={family} />
        </div>
      </>
    );
  } else if (isNotFound) {
    // No Try again: it can't fix a 404. The back link is the way out.
    content = (
      <PageHeader
        eyebrow={backLink}
        title="Family not found"
        description="This link doesn’t match a family."
      />
    );
  } else if (hasFailed) {
    content = (
      <>
        <div className="pt-5 pb-6 @5xl:pt-6 @5xl:pb-8">{backLink}</div>
        <ErrorState
          title="Couldn’t load this family"
          body="Check your connection and try again."
          onRetry={() => void household.refetch()}
          isRetrying={household.isFetching}
        />
      </>
    );
  } else {
    content = <FamilyPageSkeleton backLink={backLink} />;
  }

  return (
    <>
      {content}
      {!hasFailed && <FamilyDetailsHost family={family} />}
    </>
  );
}
