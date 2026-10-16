// One email template's editor: a slide-over on desktop, a page from the
// right on phone. Edit and Preview are tabs; placeholders insert at the
// cursor as tappable chips. The button colour is edited here too; it is
// shared by both emails. It saves on its own (one PATCH of subject, body
// and colour), and "Send me a test" mocks the /test endpoint.
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Eye, PencilLine, Send } from "lucide-react";
import { DetailOverlay } from "@/components/kit/overlays/detail-overlay";
import { Button } from "@/components/kit/components/button";
import {
  TextAreaField,
  TextField,
} from "@/components/kit/components/fields";
import { SegmentedControl } from "@/components/kit/components/tabs";
import { useToast } from "@/components/kit/overlays/use-toast";
import {
  BRAND_COLOR_KEY,
  cleanBrandColor,
  normalizeBrandColor,
  validateBrandColor,
  validateTemplate,
} from "@/lib/settings/emailTemplates";
import ColourPicker from "@/pages/prototype/settings/components/colour-picker";
import PrototypeNote from "@/pages/prototype/settings/components/prototype-note";
import type { TemplateSectionConfig } from "@/lib/settings/emailTemplates";
import type { SettingWrite } from "@/pages/prototype/settings/types/api";

const PLACEHOLDER_LABELS: Record<string, string> = {
  name: "Their name",
  actor_name: "Who invited them",
  link: "The link",
};

// What the preview fills each placeholder with.
const SAMPLE: Record<string, string> = {
  name: "Ana Ruiz",
  actor_name: "Maria Lopez",
};

const SAVE_MS = 700;

type EmailEditorProps = {
  section: TemplateSectionConfig | null;
  savedSubject: string;
  savedBody: string;
  savedBrandColor: string;
  initialBody?: string;
  initialView?: "edit" | "preview";
  onClose: () => void;
  onSave: (writes: SettingWrite[]) => void;
};

export default function EmailEditor({
  section,
  savedSubject,
  savedBody,
  savedBrandColor,
  initialBody,
  initialView = "edit",
  onClose,
  onSave,
}: EmailEditorProps): ReactNode {
  const [subject, setSubject] = useState(savedSubject);
  const [body, setBody] = useState(initialBody ?? savedBody);
  const [brandColor, setBrandColor] = useState(savedBrandColor);
  const [view, setView] = useState(initialView);
  const [isSaving, setIsSaving] = useState(false);
  // The kit's TextAreaField takes no ref, so find the textarea inside.
  const bodyRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();
  if (!section) return null;

  const error = validateTemplate(section, subject, body);
  const hasColourError = validateBrandColor(cleanBrandColor(brandColor)) !== null;
  const isColourChanged = normalizeBrandColor(brandColor) !== savedBrandColor;
  const isChanged =
    subject !== savedSubject || body !== savedBody || isColourChanged;
  const isInvalid = Boolean(error) || hasColourError;

  function insertPlaceholder(name: string): void {
    const field = bodyRef.current?.querySelector("textarea");
    const token = `{${name}}`;
    const start = field?.selectionStart ?? body.length;
    const end = field?.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    setView("edit");
  }

  function handleSave(): void {
    if (!section || isInvalid) return;
    setIsSaving(true);
    window.setTimeout(() => {
      onSave([
        { key: section.keys.subject, value: subject },
        { key: section.keys.body, value: body },
        ...(isColourChanged
          ? [{ key: BRAND_COLOR_KEY, value: normalizeBrandColor(brandColor) }]
          : []),
      ]);
      showToast({ tone: "success", message: `${section.title} email saved.` });
      onClose();
    }, SAVE_MS);
  }

  return (
    <DetailOverlay
      isOpen
      onClose={onClose}
      title={`${section.title} email`}
      backLabel="Settings"
      phoneMode="page"
      isHeaderPinned
      header={
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="kit-display text-[22px] leading-[30px] font-bold">
              {section.title} email
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
          activeId={view}
          onChange={(id) => setView(id === "preview" ? "preview" : "edit")}
          isFullWidth
        />
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="ghost"
            icon={Send}
            disabled={isInvalid}
            onClick={() =>
              showToast({
                tone: "success",
                message: "Test sent to maria@mshelpinghands.com.",
              })
            }
          >
            Send me a test
          </Button>
          <span className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={!isChanged || isInvalid}
              isLoading={isSaving}
            >
              {isSaving ? "Saving…" : "Save email"}
            </Button>
          </span>
        </div>
      }
    >
      {view === "edit" ? (
        <div className="flex flex-col gap-5">
          <TextField
            label="Subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            error={error?.field === "subject" ? error.message : undefined}
          />
          <div ref={bodyRef} className="flex flex-col gap-2">
            <TextAreaField
              label="Message"
              rows={12}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              error={error?.field === "body" ? error.message : undefined}
              help="Plain text. The link becomes a button."
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-(--tl-muted)">Insert:</span>
              {section.placeholders.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => insertPlaceholder(name)}
                  className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-(--tl-border) bg-(--tl-surface) px-3 text-[13px] font-medium hover:border-(--tl-primary) hover:bg-(--tl-tint)"
                >
                  {PLACEHOLDER_LABELS[name] ?? name}
                  <code className="text-(--tl-muted)">{`{${name}}`}</code>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <EmailPreview subject={subject} body={body} brandColor={brandColor} />
      )}
      {/* Under both tabs, so a colour change shows in Preview straight away. */}
      <div className="mt-6 flex flex-col gap-2 border-t border-(--tl-border) pt-5">
        <ColourPicker
          value={brandColor}
          isChanged={isColourChanged}
          onChange={setBrandColor}
        />
        <p className="flex items-center gap-2 text-[13px] leading-[18px] text-(--tl-muted)">
          <PrototypeNote note="Open question: there is one email_brand_color for both emails, so changing it here changes the other email too. Keep one shared colour, or one per email (API change)?" />
          Changing it here changes the other email too.
        </p>
      </div>
    </DetailOverlay>
  );
}

function fill(text: string): string {
  return text.replace(/\{([a-z_]+)\}/g, (match, name: string) => SAMPLE[name] ?? match);
}

type EmailPreviewProps = { subject: string; body: string; brandColor: string };

// Stands in for POST /email-templates/preview, which returns the real HTML.
function EmailPreview({ subject, body, brandColor }: EmailPreviewProps): ReactNode {
  const paragraphs = fill(body).split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-(--tl-muted)">
        As Ana Ruiz would see it. Names are examples.
      </p>
      <div className="overflow-hidden rounded-[16px] border border-(--tl-border) bg-white text-[#14212E]">
        <p className="border-b border-[#DCE8EF] bg-[#F4F9FB] px-5 py-3 text-[14px] font-semibold">
          {fill(subject)}
        </p>
        <div className="flex flex-col gap-3 px-5 py-5 text-[14px] leading-6">
          {paragraphs.map((paragraph, index) =>
            paragraph.trim() === "{link}" ? (
              <span
                key={index}
                className="inline-flex h-11 w-fit items-center rounded-full px-6 font-semibold text-[#14212E]"
                style={{ backgroundColor: normalizeBrandColor(brandColor) }}
              >
                Choose your password
              </span>
            ) : (
              <p key={index} className="whitespace-pre-line">
                {paragraph}
              </p>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
