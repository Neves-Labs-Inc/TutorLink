// /availability, Tutor only: the Tutor's own weekly Availability.
import type { ReactNode } from "react";
import { PageHeader } from "@/components/kit/shell/page-header";
import { InlineError } from "@/components/kit/states/states";
import { useMyProfile } from "@/hooks/useMyProfile";
import AvailabilitySection from "@/pages/availability/components/availability-section";
import AvailabilitySkeleton from "@/pages/availability/components/availability-skeleton";

export default function AvailabilityPage(): ReactNode {
  const { me } = useMyProfile();
  const tutorId = me.data?.tutor_id ?? null;
  // v5 resets a failed query to pending while it retries; the error stays up meanwhile.
  const hasFailed = !me.data && (me.isError || me.errorUpdateCount > 0);

  // A Tutor always has a teaching profile, so a loaded `me` without one
  // has nothing to show.
  let content: ReactNode = null;
  if (tutorId) {
    content = <AvailabilitySection tutorId={tutorId} />;
  } else if (hasFailed) {
    content = (
      <InlineError
        message="Couldn’t load the availability. Check your connection and try again."
        onRetry={() => void me.refetch()}
        isRetrying={me.isFetching}
      />
    );
  } else if (!me.data) {
    content = <AvailabilitySkeleton isEditable />;
  }

  return (
    <div className="max-w-[880px]">
      <PageHeader
        title="My availability"
        description="When and where the bot can offer you to Guardians. Time off overrides it."
      />
      {content}
    </div>
  );
}
