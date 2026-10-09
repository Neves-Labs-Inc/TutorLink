import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { errorDetail } from "@/lib/api";
import { settingQueries, type EmailPreview } from "@/lib/queries/settings";
import type { EmailDraftPayload } from "@/lib/settings/emailTemplates";

const PREVIEW_DEBOUNCE_MS = 300;
const PREVIEW_FALLBACK_ERROR = "Could not update the preview.";

export type EmailPreviewState = {
  // The last preview the API returned, kept while a newer one loads, fails or can't be asked for.
  preview: EmailPreview | null;
  isUpdating: boolean;
  // The draft is invalid client-side, so no request is sent.
  isInvalid: boolean;
  error: string | null;
  retry: () => void;
};

// `payload` is null while the draft is invalid. A valid draft is sent ~300ms after it stops
// changing; the first one goes at once so the preview loads with the page.
export function useEmailPreview(
  payload: EmailDraftPayload | null,
): EmailPreviewState {
  const [requested, setRequested] = useState(payload);
  const [lastPreview, setLastPreview] = useState<EmailPreview | null>(null);
  const template = payload?.template;
  const subject = payload?.subject;
  const body = payload?.body;
  const brandColor = payload?.brand_color;

  // Primitive deps: the payload object is rebuilt on every render.
  useEffect(() => {
    if (
      template === undefined ||
      subject === undefined ||
      body === undefined ||
      brandColor === undefined
    ) {
      return;
    }

    const timer = setTimeout(
      () =>
        setRequested({ template, subject, body, brand_color: brandColor }),
      PREVIEW_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [template, subject, body, brandColor]);

  // While the draft is invalid, `requested` keeps the last valid one, so nothing new is sent.
  const query = useQuery(settingQueries.emailPreview(requested));

  // Remembered across key changes so a pending or failed request never blanks the frame.
  if (query.data !== undefined && query.data !== lastPreview) {
    setLastPreview(query.data);
  }

  const preview = query.data ?? lastPreview;
  const error = query.isError
    ? (errorDetail(query.error) ?? PREVIEW_FALLBACK_ERROR)
    : null;

  return {
    preview,
    isUpdating: query.isFetching && preview !== null,
    isInvalid: payload === null,
    error,
    retry: () => void query.refetch(),
  };
}
