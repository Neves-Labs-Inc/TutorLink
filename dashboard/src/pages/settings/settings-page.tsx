// Settings: how TutorLink runs for the whole office. One page of groups
// with a jump list, one Save bar, and a leave guard while anything is
// unsaved. Admin and Developer edit; a Manager is told to ask an Admin.
import type { ReactNode } from "react";
import { Settings } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import { SaveBar } from "@/components/kit/components/save-bar";
import { SectionIndex } from "@/components/kit/components/section-index";
import { useToast } from "@/components/kit/overlays/use-toast";
import { PageHeader } from "@/components/kit/shell/page-header";
import {
  EmptyState,
  ErrorState,
  PermissionState,
} from "@/components/kit/states/states";
import { useGuardedNavigate, useLeaveGuard } from "@/hooks/use-leave-guard";
import { landingPath } from "@/lib/auth/auth";
import type { Role } from "@/lib/auth/auth";
import { SETTINGS_GROUPS } from "@/lib/settings/settings-groups";
import type { GroupId } from "@/lib/settings/settings-groups";
import BookingRulesGroup from "@/pages/settings/components/booking-rules-group";
import DeveloperGroup from "@/pages/settings/components/developer-group";
import OfficeGroup from "@/pages/settings/components/office-group";
import SettingsSkeleton from "@/pages/settings/components/settings-skeleton";
import { useSettingsForm } from "@/pages/settings/hooks/use-settings-form";
import { useAuthStore } from "@/stores/authStore";

const TITLE = "Settings";
const DESCRIPTION =
  "How TutorLink runs for the whole office. Changes apply as soon as you save.";

// The groups this page renders, in page order. Tickets 08 and 09 add
// "reminders", "emails", "chat-history" and "sign-in" in their places.
const SHOWN_GROUPS: readonly GroupId[] = [
  "booking-rules",
  "office",
  "developer",
];

export default function SettingsPage(): ReactNode {
  const role = useAuthStore((state) => state.role);
  // The route guard has settled a role before this renders.
  if (role === null) return null;

  return role === "manager" ? (
    <ManagerState role={role} />
  ) : (
    <SettingsEditor isDeveloper={role === "developer"} />
  );
}

type ManagerStateProps = { role: Role };

function ManagerState({ role }: ManagerStateProps): ReactNode {
  const navigate = useGuardedNavigate();
  return (
    <>
      <PageHeader title={TITLE} />
      <PermissionState
        title="Settings are for Admins"
        body="Ask an Admin if something about how TutorLink runs needs to change."
        action={
          <Button variant="primary" onClick={() => navigate(landingPath(role))}>
            Go to Home
          </Button>
        }
      />
    </>
  );
}

type SettingsEditorProps = { isDeveloper: boolean };

function SettingsEditor({ isDeveloper }: SettingsEditorProps): ReactNode {
  const { showToast } = useToast();
  const form = useSettingsForm({
    onSaved: () => showToast({ tone: "success", message: "Settings saved." }),
  });
  useLeaveGuard({
    changeCount: form.changeCount,
    where: TITLE,
    onDiscard: form.discard,
  });
  const sections = SETTINGS_GROUPS.filter(
    (group) =>
      SHOWN_GROUPS.includes(group.id) &&
      (isDeveloper || !group.isDeveloperOnly),
  ).map((group) => ({
    id: group.id,
    title: group.title,
    count: form.countIn(group.id),
  }));

  let body: ReactNode;
  if (form.status === "loading") {
    body = <SettingsSkeleton />;
  } else if (form.status === "error") {
    body = (
      <ErrorState
        title="Couldn’t load Settings"
        body="Check your connection and try again."
        onRetry={form.retry}
        isRetrying={form.isRetrying}
      />
    );
  } else if (form.status === "empty") {
    body = (
      <EmptyState
        icon={Settings}
        title="Settings aren’t set up yet"
        body="Ask your developer to finish setting up TutorLink."
      />
    );
  } else {
    body = (
      <div className="grid gap-8 @5xl:grid-cols-[200px_minmax(0,1fr)]">
        <SectionIndex
          label="Settings groups"
          sections={sections}
          layout="column"
        />
        <div className="flex max-w-[880px] min-w-0 flex-col gap-6">
          <BookingRulesGroup form={form} />
          {/* 08: Booking reminders */}
          <OfficeGroup form={form} />
          {/* 09: Emails · 08: Chat history, Sign-in protection */}
          {isDeveloper && <DeveloperGroup form={form} />}
          <SaveBar
            changeCount={form.changeCount}
            hasErrors={form.hasShownErrors}
            saveState={form.saveState}
            onSave={form.save}
            onDiscard={form.discard}
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader title={TITLE} description={DESCRIPTION}>
        {form.status === "ready" && (
          <SectionIndex
            label="Settings groups"
            sections={sections}
            layout="row"
          />
        )}
      </PageHeader>
      {body}
    </>
  );
}
