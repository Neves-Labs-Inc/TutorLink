// "Your availability" on a Manager's profile: Managers who teach set
// their own week here, as Tutors do on My availability.
import type { ReactNode } from "react";
import { HEADING } from "@/components/kit/tokens";
import AvailabilitySection from "@/pages/availability/components/availability-section";

type ProfileAvailabilityProps = { tutorId: string };

export default function ProfileAvailability({
  tutorId,
}: ProfileAvailabilityProps): ReactNode {
  return (
    <section
      aria-labelledby="profile-availability"
      className="flex max-w-[720px] flex-col"
    >
      <h2 id="profile-availability" className={HEADING}>
        Your availability
      </h2>
      <p className="mb-4 text-[14px] leading-5 text-(--tl-muted)">
        You teach too: the bot offers you to Guardians in these times.
      </p>
      <AvailabilitySection tutorId={tutorId} />
    </section>
  );
}
