// The page when it isn't showing settings: loading, failed to load, no
// rows at all, and a Manager who reached the URL.
import type { ReactNode } from "react";
import { Settings } from "lucide-react";
import { AppShell } from "@/components/kit/shell/app-shell";
import { CURRENT_USER } from "@/pages/prototype/shared/mock-data";
import type { Role } from "@/pages/prototype/shared/mock-data";
import { getMockNav } from "@/pages/prototype/shared/mock-nav";
import type { NavId } from "@/components/kit/shell/nav";
import { PageHeader } from "@/components/kit/shell/page-header";
import { Button } from "@/components/kit/components/button";
import {
  EmptyState,
  ErrorState,
  PermissionState,
  Skeleton,
} from "@/components/kit/states/states";
import { CARD, cn } from "@/components/kit/tokens";

export type StateKind = "loading" | "error" | "empty" | "manager";

type SettingsStatesProps = {
  kind: StateKind;
  role: Role;
  onRetry: () => void;
  onNavigate: (id: NavId) => void;
};

const SKELETON_CARDS = [4, 3, 3];

export default function SettingsStates({
  kind,
  role,
  onRetry,
  onNavigate,
}: SettingsStatesProps): ReactNode {
  let body: ReactNode;
  if (kind === "loading") {
    body = (
      <div role="status" aria-label="Loading settings" className="flex max-w-[880px] flex-col gap-6 @5xl:ml-[232px]">
        {SKELETON_CARDS.map((fields, card) => (
          <div key={card} className={cn(CARD, "flex flex-col gap-6 p-6")}>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-40 rounded-full" />
              <Skeleton className="h-3 w-72 max-w-full rounded-full" />
            </div>
            <div className="grid gap-6 @3xl:grid-cols-2">
              {Array.from({ length: fields }, (_, field) => (
                <div key={field} className="flex flex-col gap-2">
                  <Skeleton className="h-3 w-32 rounded-full" />
                  <Skeleton className="h-11 w-full max-w-[320px] rounded-full" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  } else if (kind === "error") {
    body = (
      <ErrorState
        title="Couldn't load Settings"
        body="Check your connection, then try again. Nothing was changed."
        onRetry={onRetry}
      />
    );
  } else if (kind === "empty") {
    body = (
      <EmptyState
        icon={Settings}
        title="Settings aren't set up yet"
        body="TutorLink didn't find any settings, so setup didn't finish. Booking and the bot won't work until it does. Ask your developer."
      />
    );
  } else {
    body = (
      <PermissionState
        title="Settings are for Admins"
        body="Ask an Admin if something about how TutorLink runs needs to change."
        action={
          <Button variant="primary" onClick={() => onNavigate("home")}>
            Go to Home
          </Button>
        }
      />
    );
  }

  return (
    <AppShell
      name={CURRENT_USER[role].name}
      roleLabel={CURRENT_USER[role].role}
      items={getMockNav(role)}
      activeId="settings"
      onNavigate={onNavigate}
    >
      <PageHeader title="Settings" />
      {body}
    </AppShell>
  );
}
