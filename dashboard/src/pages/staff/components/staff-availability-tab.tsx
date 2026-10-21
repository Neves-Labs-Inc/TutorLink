// Staff details ▸ Availability: the person's week. Only an Admin edits
// it, and only for live Staff; everyone else reads.
import type { ReactNode } from "react";
import AvailabilitySection from "@/pages/availability/components/availability-section";
import { getFirstName } from "@/pages/time-off/lib/time-off-copy";
import type { StaffRead } from "@/lib/queries/staff";

type StaffAvailabilityTabProps = { staff: StaffRead; canEdit: boolean };

export default function StaffAvailabilityTab({
  staff,
  canEdit,
}: StaffAvailabilityTabProps): ReactNode {
  // The tab only exists for people with a teaching profile.
  if (staff.tutor_id === null) return null;

  return (
    <AvailabilitySection
      tutorId={staff.tutor_id}
      ownerName={getFirstName(staff.name)}
      isReadOnly={!canEdit}
      isInOverlay
    />
  );
}
