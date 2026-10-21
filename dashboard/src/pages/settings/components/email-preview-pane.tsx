// The Preview tab: the API's real HTML for the draft, in a sandboxed frame.
// The frame keeps fixed light colours in dark mode too: it shows the email
// as an inbox would (DESIGN.md §2.1).
import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { InlineError, Skeleton } from "@/components/kit/states/states";
import { cn } from "@/components/kit/tokens";
import { useEmailPreview } from "@/hooks/useEmailPreview";
import { previewDocument } from "@/lib/settings/emailTemplates";
import type { EmailDraftPayload } from "@/lib/settings/emailTemplates";

const FRAME = "overflow-hidden rounded-[16px] border border-(--tl-border)";
// The API fills the placeholders with this name.
const SAMPLE_NAME = "Alex Smith";

type EmailPreviewPaneProps = {
  title: string;
  // Null while the draft is invalid.
  payload: EmailDraftPayload | null;
};

export default function EmailPreviewPane({
  title,
  payload,
}: EmailPreviewPaneProps): ReactNode {
  const { preview, isUpdating, isInvalid, error, retry } =
    useEmailPreview(payload);

  let body: ReactNode;
  if (isInvalid) {
    body = (
      <p className="flex items-start gap-2 rounded-[16px] bg-(--tl-surface-sunk) p-4 text-[14px] leading-5 text-(--tl-muted)">
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        Fix the highlighted field to update the preview.
      </p>
    );
  } else if (error !== null) {
    body = <InlineError message="Couldn’t load the preview" onRetry={retry} />;
  } else if (preview === null) {
    body = <PreviewSkeleton />;
  } else {
    body = (
      <>
        <p className="text-[13px] leading-[18px] text-(--tl-muted)">
          As {SAMPLE_NAME} would see it. Names are examples.
        </p>
        {/* No sandbox permissions: the API HTML can't run scripts or reach this origin's token. */}
        <iframe
          sandbox=""
          title={title}
          aria-busy={isUpdating}
          srcDoc={previewDocument(preview.html)}
          className={cn(
            FRAME,
            "block h-[480px] w-full bg-white transition-opacity duration-150",
            isUpdating && "opacity-60",
          )}
        />
      </>
    );
  }

  return <div className="flex flex-col gap-3">{body}</div>;
}

// The frame's shape, so nothing shifts when the email arrives.
function PreviewSkeleton(): ReactNode {
  return (
    <div
      role="status"
      aria-label="Loading preview"
      className={cn(FRAME, "flex min-h-[480px] flex-col gap-3 p-5")}
    >
      <Skeleton className="h-12 rounded-[12px]" />
      <Skeleton className="h-4 w-full rounded-full" />
      <Skeleton className="h-4 w-[90%] rounded-full" />
      <Skeleton className="h-4 w-[95%] rounded-full" />
      <Skeleton className="h-4 w-[60%] rounded-full" />
      <Skeleton className="h-11 w-48 rounded-full" />
    </div>
  );
}
