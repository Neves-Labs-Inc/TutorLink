// One email's editor: a slide-over from 672px, a page on phones. It stays
// mounted and is driven by `isOpen`, so its exit plays. It saves on its
// own, not with the page's Save bar.
import type { ReactNode } from "react";
import { CircleAlert, Eye, PencilLine, Send } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import { SegmentedControl } from "@/components/kit/components/tabs";
import { DetailOverlay } from "@/components/kit/overlays/detail-overlay";
import type { TemplateSectionConfig } from "@/lib/settings/emailTemplates";
import EmailColourPicker from "@/pages/settings/components/email-colour-picker";
import EmailEditFields from "@/pages/settings/components/email-edit-fields";
import EmailPreviewPane from "@/pages/settings/components/email-preview-pane";
import { useEmailEditor } from "@/pages/settings/hooks/use-email-editor";
import type { SavedEmail } from "@/pages/settings/hooks/use-email-editor";

type EmailEditorProps = {
  section: TemplateSectionConfig;
  saved: SavedEmail;
  isOpen: boolean;
  onClose: () => void;
};

export default function EmailEditor({
  section,
  saved,
  isOpen,
  onClose,
}: EmailEditorProps): ReactNode {
  const editor = useEmailEditor({ section, saved, isOpen, onSaved: onClose });
  const title = `${section.title} email`;

  function handleClose(): void {
    editor.reset();
    onClose();
  }

  return (
    <DetailOverlay
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      backLabel="Settings"
      phoneMode="page"
      isHeaderPinned
      header={
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="kit-display text-[22px] leading-[30px] font-bold">
              {title}
            </h2>
            <p className="text-[13px] leading-[18px] text-(--tl-muted)">
              Changes here save on their own, not with the page.
            </p>
          </div>
          <SegmentedControl
            label="Edit or preview"
            items={[
              { id: "edit", label: "Edit", icon: PencilLine },
              { id: "preview", label: "Preview", icon: Eye },
            ]}
            activeId={editor.view}
            onChange={(id) => editor.setView(id === "preview" ? "preview" : "edit")}
            isFullWidth
          />
        </div>
      }
      footer={
        <div className="flex flex-1 flex-col gap-2 @md:flex-row @md:flex-wrap @md:items-center">
          {editor.footerError !== null && (
            <p
              role="alert"
              className="flex basis-full items-start gap-1.5 text-[13px] leading-[18px] font-medium text-(--tl-danger)"
            >
              <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
              {editor.footerError}
            </p>
          )}
          {/* Stacked on a phone: Save, Test, Cancel. From 672px the DOM order is the visual one. */}
          <Button
            variant="ghost"
            icon={Send}
            isFullWidth
            className="order-2 @md:order-none @md:mr-auto @md:w-auto"
            disabled={editor.isInvalid}
            isLoading={editor.isSendingTest}
            onClick={editor.sendTest}
          >
            {editor.isSendingTest ? "Sending…" : "Send me a test"}
          </Button>
          <Button
            variant="outline"
            isFullWidth
            className="order-3 @md:order-none @md:w-auto"
            disabled={editor.isSaving}
            onClick={handleClose}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            isFullWidth
            className="order-1 @md:order-none @md:w-auto"
            disabled={!editor.isChanged || editor.isInvalid}
            isLoading={editor.isSaving}
            onClick={editor.save}
          >
            {editor.isSaving ? "Saving…" : "Save email"}
          </Button>
        </div>
      }
    >
      {editor.view === "edit" ? (
        <EmailEditFields
          section={section}
          subject={editor.subject}
          body={editor.body}
          error={editor.templateError}
          onSubjectChange={editor.setSubject}
          onBodyChange={editor.setBody}
        />
      ) : (
        <EmailPreviewPane title={`${title} preview`} payload={editor.payload} />
      )}
      {/* Under both tabs, so a colour change shows in Preview straight away. */}
      <div className="mt-6 border-t border-(--tl-border) pt-5">
        <EmailColourPicker
          value={editor.brandColor}
          isChanged={editor.isColourChanged}
          onChange={editor.setBrandColor}
        />
      </div>
    </DetailOverlay>
  );
}
