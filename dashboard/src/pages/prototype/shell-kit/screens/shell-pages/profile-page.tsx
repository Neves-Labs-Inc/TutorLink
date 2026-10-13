// Profile: opened from the sidebar user card or the phone avatar. Shows
// who's signed in and Sign out. A Manager also teaches, so their own
// Availability lives here (the same editor as Tutor ▸ My availability).
import { useState } from "react";
import type { ReactNode } from "react";
import { LogOut, Mail } from "lucide-react";
import {
  CURRENT_USER,
  MANAGER_AVAILABILITY,
} from "@/pages/prototype/shell-kit/kit/mock-data";
import type { Role } from "@/pages/prototype/shell-kit/kit/mock-data";
import { CARD, cn, HEADING } from "@/pages/prototype/shell-kit/kit/tokens";
import { Avatar } from "@/pages/prototype/shell-kit/kit/components/badges";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import { AvailabilityEditor } from "@/pages/prototype/shell-kit/kit/components/availability-editor";
import { PageHeader } from "@/pages/prototype/shell-kit/kit/shell/page-header";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";

type ProfilePageProps = { role: Role };

export default function ProfilePage({ role }: ProfilePageProps): ReactNode {
  const user = CURRENT_USER[role];
  const [slots, setSlots] = useState(MANAGER_AVAILABILITY);
  const { showToast } = useToast();
  const email = `${user.first.toLowerCase()}@mshelpinghands.com`;

  return (
    <>
      <PageHeader title="Your profile" />
      <section className={cn(CARD, "flex flex-col gap-4 p-5 @2xl:flex-row @2xl:items-center @2xl:p-6")}>
        <Avatar name={user.name} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="kit-display text-[24px] leading-8 font-light">{user.name}</p>
          <p className="flex items-center gap-2 text-[14px] text-(--tl-muted)">
            {user.role}
            <span aria-hidden>·</span>
            <Mail aria-hidden className="size-4" />
            {email}
          </p>
        </div>
        <Button
          variant="danger-outline"
          icon={LogOut}
          onClick={() =>
            showToast({ tone: "info", message: "Signing out is off in the prototype." })
          }
        >
          Sign out
        </Button>
      </section>
      {role === "manager" && (
        <section aria-labelledby="profile-availability" className="mt-10">
          <h2 id="profile-availability" className={HEADING}>
            Your availability
          </h2>
          <p className="mt-1 mb-4 text-[14px] text-(--tl-muted)">
            You teach too: Guardians can book you through the bot in these times.
          </p>
          <AvailabilityEditor
            slots={slots}
            onSave={(next) => {
              setSlots(next);
              showToast({ tone: "success", message: "Availability saved." });
            }}
          />
        </section>
      )}
    </>
  );
}
