import EmailPreviewSkeleton from "@/components/settings/EmailPreviewSkeleton";
import {
  ERROR_LINE,
  FADE_IN,
} from "@/components/settings/emailTemplateClasses";
import { Button } from "@/components/ui/button";
import { useEmailPreview } from "@/hooks/useEmailPreview";
import type { EmailPreview as EmailPreviewData } from "@/lib/queries/settings";
import {
  previewDocument,
  type EmailDraftPayload,
  type TemplateSectionConfig,
} from "@/lib/settings/emailTemplates";
import { cn } from "@/lib/utils";

type EmailPreviewProps = {
  section: TemplateSectionConfig;
  // Null while the section draft or the brand colour is invalid.
  payload: EmailDraftPayload | null;
};

type InboxFrameProps = {
  preview: EmailPreviewData;
  title: string;
  isDimmed: boolean;
  isBusy: boolean;
};

const BLANK_SUBJECT = "—";
const INVALID_MESSAGE = "Fix the errors above to update the preview.";

// Reads like a message in an inbox: the subject and sender above the email itself.
function InboxFrame({
  preview,
  title,
  isDimmed,
  isBusy,
}: InboxFrameProps): React.ReactNode {
  return (
    <div
      aria-busy={isBusy}
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-card transition-opacity duration-150 ease-out motion-reduce:transition-none",
        isDimmed ? "opacity-50" : "opacity-100",
      )}
    >
      <div className="space-y-2 border-b border-border px-4 py-3">
        <p
          className={cn(
            "text-base font-semibold wrap-anywhere",
            preview.subject === "" && "text-muted-foreground",
          )}
        >
          {preview.subject || BLANK_SUBJECT}
        </p>
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
          >
            T
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">TutorLink</p>
            <p className="text-xs text-muted-foreground">to Alex Smith</p>
          </div>
        </div>
      </div>
      {/* No sandbox permissions: the API HTML can't run scripts or reach this origin's token. */}
      <iframe
        sandbox=""
        title={title}
        srcDoc={previewDocument(preview.html)}
        className="block h-144 w-full border-0"
      />
    </div>
  );
}

export default function EmailPreview({
  section,
  payload,
}: EmailPreviewProps): React.ReactNode {
  const { preview, isUpdating, isInvalid, error, retry } =
    useEmailPreview(payload);
  const isDimmed = isInvalid || error !== null;
  const isLoading = preview === null && !isInvalid && error === null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">
          Preview <span className="font-normal">· Sample values</span>
        </p>
        <span
          aria-hidden
          className={cn(
            "text-xs text-muted-foreground transition-opacity ease-out motion-reduce:transition-none",
            isUpdating
              ? "opacity-100 delay-150 duration-150"
              : "opacity-0 duration-100",
          )}
        >
          Updating…
        </span>
      </div>
      {isInvalid && (
        <p className={cn("text-sm text-muted-foreground duration-150", FADE_IN)}>
          {INVALID_MESSAGE}
        </p>
      )}
      {!isInvalid && error !== null && (
        <div className="mb-3 flex flex-col items-start gap-1.5">
          <p role="alert" className={cn(ERROR_LINE, FADE_IN)}>
            {error}
          </p>
          <Button
            type="button"
            variant="outline"
            className="h-11 md:h-8"
            onClick={retry}
          >
            Try again
          </Button>
        </div>
      )}
      {isLoading && (
        <div aria-busy="true">
          <span className="sr-only">Loading preview…</span>
          <EmailPreviewSkeleton />
        </div>
      )}
      {preview !== null && (
        <InboxFrame
          preview={preview}
          title={`${section.title} email preview`}
          isDimmed={isDimmed}
          isBusy={isUpdating}
        />
      )}
    </div>
  );
}
