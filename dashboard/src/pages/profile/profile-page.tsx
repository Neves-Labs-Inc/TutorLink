// /profile for every role: who you are, your Display name, how the app
// looks on this device, and the app's only Sign out.
import { useState } from "react";
import type { ReactNode } from "react";
import { LogOut, Mail, Pencil, Phone } from "lucide-react";
import { Avatar } from "@/components/kit/components/badges";
import { Button } from "@/components/kit/components/button";
import { RadioCards } from "@/components/kit/components/choices";
import type { RadioOption } from "@/components/kit/components/choices";
import { PageHeader } from "@/components/kit/shell/page-header";
import { InlineError, Skeleton } from "@/components/kit/states/states";
import { CARD, HEADING, cn } from "@/components/kit/tokens";
import { useAuth } from "@/hooks/useAuth";
import { useMyProfile } from "@/hooks/useMyProfile";
import { useTheme } from "@/hooks/use-theme";
import { formatPhoneForDisplay } from "@/lib/guardians/guardians";
import { parsePreference } from "@/lib/theme/theme";
import { roleLabel } from "@/lib/users/users";
import { DisplayNameSheet } from "@/pages/profile/display-name-sheet";
import ProfileAvailability from "@/pages/profile/profile-availability";

const THEME_OPTIONS: RadioOption[] = [
  { value: "light", label: "Light", description: "Always light." },
  { value: "dark", label: "Dark", description: "Always dark." },
  {
    value: "system",
    label: "System",
    description: "Follows this device’s setting.",
  },
];

const BUTTON_WIDTH = "w-full @2xl:w-auto";

export default function ProfilePage(): ReactNode {
  const { me } = useMyProfile();
  const { logout } = useAuth();
  const { preference, setPreference } = useTheme();
  const [isEditing, setIsEditing] = useState(false);
  const person = me.data;

  // v5 resets a failed query to pending while it retries; the error stays up meanwhile.
  const hasFailed = !person && (me.isError || me.errorUpdateCount > 0);
  const isLoading = me.isPending && !hasFailed;
  const signOut = <SignOutButton onClick={logout} />;
  // Only a teaching Manager sets their week here; Tutors have My availability.
  const managerTutorId =
    person?.role === "manager" ? (person.tutor_id ?? null) : null;
  const officePhone =
    person?.role === "tutor" ? (person.office_phone ?? null) : null;

  return (
    <>
      <PageHeader title="Your profile" />
      <div className="flex flex-col gap-10">
        {isLoading && <IdentitySkeleton signOut={signOut} />}
        {hasFailed && (
          <>
            <InlineError
              message="Couldn’t load your profile. Check your connection and try again."
              onRetry={() => void me.refetch()}
              isRetrying={me.isFetching}
            />
            <div className="flex">{signOut}</div>
          </>
        )}
        {person && (
          <section
            aria-label="You"
            className={cn(
              CARD,
              "flex flex-col gap-4 p-5 @2xl:flex-row @2xl:items-center @2xl:p-6",
            )}
          >
            <Avatar name={person.name || person.email} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="kit-display text-[24px] leading-8 font-light break-words">
                {person.name || person.email}
              </p>
              <p className="flex flex-wrap items-center gap-x-2 text-[14px] leading-5 text-(--tl-muted)">
                <span>{roleLabel(person.role)}</span>
                <span aria-hidden>·</span>
                <span className="inline-flex min-w-0 items-start gap-1.5">
                  <Mail aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span className="break-all">{person.email}</span>
                </span>
                {officePhone && <OfficePhone phone={officePhone} />}
              </p>
            </div>
            <div className="flex flex-col gap-2 @2xl:flex-row">
              <Button
                icon={Pencil}
                className={BUTTON_WIDTH}
                onClick={() => setIsEditing(true)}
              >
                Edit display name
              </Button>
              {signOut}
            </div>
          </section>
        )}
        {managerTutorId && <ProfileAvailability tutorId={managerTutorId} />}
        <section
          aria-labelledby="profile-appearance"
          className="flex max-w-[720px] flex-col"
        >
          <h2 id="profile-appearance" className={HEADING}>
            Appearance
          </h2>
          <p className="mb-4 text-[14px] leading-5 text-(--tl-muted)">
            Applies on this device only.
          </p>
          <RadioCards
            legend="Theme"
            options={THEME_OPTIONS}
            value={preference}
            onChange={(value) => setPreference(parsePreference(value))}
            isHorizontal
          />
        </section>
      </div>
      {person && (
        <DisplayNameSheet
          isOpen={isEditing}
          onClose={() => setIsEditing(false)}
          savedName={person.name}
        />
      )}
    </>
  );
}

type OfficePhoneProps = { phone: string };

// Inline text in the meta line, so the 44px target rule doesn't apply.
// It takes its own line under the email at every width, so no separator
// is ever left dangling at a wrap.
function OfficePhone({ phone }: OfficePhoneProps): ReactNode {
  return (
    <span className="inline-flex min-w-0 basis-full items-start gap-1.5">
      <Phone aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>
        The office:{" "}
        <a
          href={`tel:${phone}`}
          className="font-semibold text-(--tl-link) tabular-nums underline-offset-4 hover:underline"
        >
          {formatPhoneForDisplay(phone)}
        </a>
      </span>
    </span>
  );
}

type SignOutButtonProps = { onClick: () => void };

function SignOutButton({ onClick }: SignOutButtonProps): ReactNode {
  return (
    <Button
      variant="danger-outline"
      icon={LogOut}
      className={BUTTON_WIDTH}
      onClick={onClick}
    >
      Sign out
    </Button>
  );
}

// Same box as the loaded card, so nothing moves when it arrives.
type IdentitySkeletonProps = { signOut: ReactNode };

function IdentitySkeleton({ signOut }: IdentitySkeletonProps): ReactNode {
  return (
    <div
      role="status"
      aria-label="Loading your profile"
      className={cn(
        CARD,
        "flex flex-col gap-4 p-5 @2xl:flex-row @2xl:items-center @2xl:p-6",
      )}
    >
      <Skeleton className="size-12 rounded-full" />
      <div className="flex min-w-0 flex-1 flex-col">
        <Skeleton className="my-0.5 h-7 w-48 max-w-full rounded-full" />
        <Skeleton className="my-[3px] h-3.5 w-64 max-w-full rounded-full" />
      </div>
      <div className="flex flex-col gap-2 @2xl:flex-row">
        <Skeleton className="h-11 w-full rounded-full @2xl:w-44" />
        {signOut}
      </div>
    </div>
  );
}
