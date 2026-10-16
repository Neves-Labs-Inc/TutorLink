// The Settings page inside the app shell: header, group index, the
// groups, one Save bar, the template editor and the two confirms
// (shorter chat history; leaving with unsaved changes).
import { useState } from "react";
import type { ReactNode } from "react";
import { AppShell } from "@/pages/prototype/shell-kit/kit/shell/app-shell";
import type { NavId } from "@/pages/prototype/shell-kit/kit/shell/nav";
import { PageHeader } from "@/pages/prototype/shell-kit/kit/shell/page-header";
import { ConfirmDialog } from "@/pages/prototype/shell-kit/kit/overlays/dialog";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";
import { pluralize } from "@/pages/prototype/shell-kit/kit/format";
import { TEMPLATE_SECTIONS } from "@/lib/settings/emailTemplates";
import type { TemplateSectionId } from "@/lib/settings/emailTemplates";
import { useSettings } from "@/pages/prototype/settings/hooks/use-settings";
import type { SettingsPage as SettingsPageWire } from "@/pages/prototype/settings/types/api";
import { SECTIONS } from "@/pages/prototype/settings/lib/sections";
import { formatDuration, RETENTION_UNITS } from "@/pages/prototype/settings/lib/units";
import {
  formatHour,
  getShortZoneName,
  utcToZoneHour,
} from "@/pages/prototype/settings/lib/time";
import PrototypeNote from "@/pages/prototype/settings/components/prototype-note";
import SectionIndex from "@/pages/prototype/settings/components/section-index";
import BookingRulesSection from "@/pages/prototype/settings/components/booking-rules-section";
import RemindersSection from "@/pages/prototype/settings/components/reminders-section";
import OfficeSection from "@/pages/prototype/settings/components/office-section";
import EmailsSection from "@/pages/prototype/settings/components/emails-section";
import ChatHistorySection from "@/pages/prototype/settings/components/chat-history-section";
import SignInSection from "@/pages/prototype/settings/components/sign-in-section";
import DeveloperSection from "@/pages/prototype/settings/components/developer-section";
import EmailEditor from "@/pages/prototype/settings/components/email-editor";
import SaveBar from "@/pages/prototype/settings/components/save-bar";

export type SettingsSetup = {
  initialDraft?: Record<string, string>;
  shouldSaveFail?: boolean;
  openTemplate?: TemplateSectionId;
  templateBody?: string;
  templateView?: "edit" | "preview";
  isSignInOpen?: boolean;
  dialog?: "retention" | "leave";
};

type SettingsPageProps = {
  isDeveloper: boolean;
  wire: SettingsPageWire;
  setup: SettingsSetup;
};

export default function SettingsPage({
  isDeveloper,
  wire,
  setup,
}: SettingsPageProps): ReactNode {
  const { showToast } = useToast();
  const settings = useSettings({
    initialPage: wire,
    initialDraft: setup.initialDraft,
    shouldSaveFail: setup.shouldSaveFail ?? false,
    onSaved: () => showToast({ tone: "success", message: "Settings saved." }),
  });
  const [templateId, setTemplateId] = useState<TemplateSectionId | null>(
    setup.openTemplate ?? null,
  );
  const [dialog, setDialog] = useState(setup.dialog ?? null);
  const [pendingNav, setPendingNav] = useState<NavId | null>(
    setup.dialog === "leave" ? "home" : null,
  );
  const sections = SECTIONS.filter((section) => isDeveloper || !section.isDeveloperOnly);
  const template = TEMPLATE_SECTIONS.find((section) => section.id === templateId) ?? null;
  const changeCount = settings.updates.length;

  function leaveTo(): void {
    showToast({ tone: "info", message: "Only Settings is in this prototype." });
  }

  function handleNavigate(id: NavId): void {
    if (id === "settings") return;
    if (changeCount > 0) {
      setPendingNav(id);
      setDialog("leave");
      return;
    }
    leaveTo();
  }

  function handleSave(): void {
    if (settings.isRetentionShortened) {
      setDialog("retention");
      return;
    }
    settings.save();
  }

  const zone = settings.valueOf("business_timezone");
  const purgeAt = `${formatHour(utcToZoneHour(Number(settings.valueOf("retention_purge_hour_utc")), zone))} ${getShortZoneName(zone)}`;
  const retention = formatDuration(Number(settings.valueOf("chat_retention_days")), RETENTION_UNITS);

  return (
    <AppShell role="admin" activeId="settings" onNavigate={handleNavigate}>
      <PageHeader
        title="Settings"
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            How TutorLink runs for the whole office. Changes apply as soon as you save.
            <PrototypeNote note="Open question: the grouping (Booking rules · Booking reminders · Office · Emails · Chat history · Sign-in protection) is a placeholder. One long page with a jump list, or tabs per group?" />
          </span>
        }
      >
        <SectionIndex sections={sections} changedIn={settings.changedIn} layout="row" />
      </PageHeader>
      <div className="grid gap-8 @5xl:grid-cols-[200px_minmax(0,1fr)]">
        <SectionIndex sections={sections} changedIn={settings.changedIn} layout="column" />
        <div className="flex max-w-[880px] min-w-0 flex-col gap-6">
          <BookingRulesSection settings={settings} />
          <RemindersSection settings={settings} onOpenChats={() => handleNavigate("chats")} />
          <OfficeSection settings={settings} />
          <EmailsSection settings={settings} onOpenTemplate={setTemplateId} />
          <ChatHistorySection settings={settings} />
          <SignInSection settings={settings} isInitiallyOpen={setup.isSignInOpen ?? false} />
          {isDeveloper && <DeveloperSection settings={settings} />}
          <SaveBar
            changeCount={changeCount}
            hasErrors={settings.hasErrors}
            saveState={settings.saveState}
            onSave={handleSave}
            onDiscard={settings.discard}
          />
        </div>
      </div>
      {template && (
        <EmailEditor
          key={template.id}
          section={template}
          savedSubject={settings.savedValueOf(template.keys.subject)}
          savedBody={settings.savedValueOf(template.keys.body)}
          savedBrandColor={settings.savedValueOf("email_brand_color")}
          initialBody={setup.templateBody}
          initialView={setup.templateView}
          onClose={() => setTemplateId(null)}
          onSave={settings.saveTemplate}
        />
      )}
      <ConfirmDialog
        isOpen={dialog === "retention"}
        onClose={() => setDialog(null)}
        onConfirm={() => {
          setDialog(null);
          settings.save();
        }}
        title="Delete older chats?"
        confirmLabel="Save and delete"
        keepLabel="Keep editing"
        isDestructive
      >
        Messages older than {retention} will be deleted at the next clean-up,
        today at {purgeAt}. Chats left empty go too. This can't be undone.
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={dialog === "leave"}
        onClose={() => {
          setDialog(null);
          setPendingNav(null);
        }}
        onConfirm={() => {
          setDialog(null);
          settings.discard();
          if (pendingNav) leaveTo();
        }}
        title="Leave without saving?"
        confirmLabel="Discard changes"
        keepLabel="Keep editing"
        isDestructive
      >
        You have{" "}
        {pluralize(Math.max(changeCount, 1), "unsaved change", "unsaved changes")}{" "}
        in Settings. If you leave now, they're lost.
      </ConfirmDialog>
    </AppShell>
  );
}
