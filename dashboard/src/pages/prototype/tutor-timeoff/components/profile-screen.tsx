// The profile, opened from the sidebar card or the phone avatar: the
// person's details and Sign out. A Manager's also holds their
// Availability on the one-Edit editor (#191); their own sessions come
// from Bookings › Mine and their time off from the Time off nav item.
import type { ReactNode } from "react";
import { LogOut, Mail, Phone } from "lucide-react";
import { Avatar } from "@/pages/prototype/shell-kit/kit/components/badges";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import { PageHeader } from "@/pages/prototype/shell-kit/kit/shell/page-header";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";
import { CARD, cn, HEADING } from "@/pages/prototype/shell-kit/kit/tokens";
import AvailabilitySection from "@/pages/prototype/tutor-timeoff/components/availability-section";
import OpenQuestion from "@/pages/prototype/tutor-timeoff/components/open-question";
import { formatPhone, ROLE_LABEL } from "@/pages/prototype/tutor-timeoff/lib/labels";
import type { AreaStore } from "@/pages/prototype/tutor-timeoff/hooks/use-area-store";
import type { Phase } from "@/pages/prototype/tutor-timeoff/hooks/use-load-phase";

// Grilling ticket #227; marked here, no UI for it.
const UNMARKED_QUESTION =
  "Me is gone. Who marks a Manager’s own unmarked sessions, and where? (#227)";

type ProfileScreenProps = {
  store: AreaStore;
  phase: Phase;
  isRetrying: boolean;
  onRetry: () => void;
};

export default function ProfileScreen({
  store,
  phase,
  isRetrying,
  onRetry,
}: ProfileScreenProps): ReactNode {
  const { me } = store;
  const { showToast } = useToast();
  const isManager = me.role === "manager";

  return (
    <>
      <PageHeader title="Your profile" />
      <section className={cn(CARD, "flex flex-col gap-4 p-5 @2xl:flex-row @2xl:items-center @2xl:p-6")}>
        <Avatar name={me.name} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="kit-display text-[24px] leading-8 font-light">{me.name}</p>
          <p className="flex flex-wrap items-center gap-x-2 text-[14px] text-(--tl-muted)">
            {ROLE_LABEL[me.role]}
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1.5">
              <Mail aria-hidden className="size-4" />
              {me.email}
            </span>
          </p>
          {me.role === "tutor" && me.office_phone && (
            <p className="mt-1 flex items-center gap-1.5 text-[14px] text-(--tl-muted)">
              <Phone aria-hidden className="size-4" />
              The office: {formatPhone(me.office_phone)}
            </p>
          )}
        </div>
        <Button
          variant="danger-outline"
          icon={LogOut}
          onClick={() => showToast({ tone: "info", message: "Signing out is off in the prototype." })}
        >
          Sign out
        </Button>
      </section>

      {isManager && (
        <section aria-labelledby="profile-availability" className="mt-10">
          <h2 id="profile-availability" className={cn(HEADING, "flex items-center gap-3")}>
            Your availability
            <OpenQuestion question={UNMARKED_QUESTION} />
          </h2>
          <p className="mt-1 mb-4 text-[14px] text-(--tl-muted)">
            You teach too: the bot offers you to Guardians in these times.
          </p>
          <AvailabilitySection
            phase={phase}
            isRetrying={isRetrying}
            onRetry={onRetry}
            rows={store.availability}
            onSave={store.saveAvailability}
          />
        </section>
      )}
    </>
  );
}
