// One email's editor state: the draft subject, body and colour, what is
// wrong with them, and the two things the editor does with them (save and
// send a test). The draft starts from the saved values every time the
// editor opens, so closing discards.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/kit/overlays/use-toast";
import { meQueries } from "@/lib/queries/me";
import {
  sendTestEmail,
  settingQueries,
  updateSettings,
} from "@/lib/queries/settings";
import {
  cleanBrandColor,
  draftEmailPayload,
  normalizeBrandColor,
  validateBrandColor,
  validateTemplate,
} from "@/lib/settings/emailTemplates";
import type {
  EmailDraftPayload,
  TemplateError,
  TemplateSectionConfig,
} from "@/lib/settings/emailTemplates";

export type EmailEditorView = "edit" | "preview";

export type SavedEmail = { subject: string; body: string; brandColor: string };

const SAVE_FAILED = "Couldn’t save the email. Check your connection and try again.";
const TEST_FAILED = "Couldn’t send the test. Check your connection and try again.";

type UseEmailEditorOptions = {
  section: TemplateSectionConfig;
  saved: SavedEmail;
  isOpen: boolean;
  onSaved: () => void;
};

export type EmailEditor = {
  subject: string;
  body: string;
  brandColor: string;
  view: EmailEditorView;
  setSubject: (value: string) => void;
  setBody: (value: string) => void;
  setBrandColor: (value: string) => void;
  setView: (view: EmailEditorView) => void;
  templateError: TemplateError | null;
  colourError: string | null;
  isColourChanged: boolean;
  isChanged: boolean;
  isInvalid: boolean;
  // Null while the draft is invalid, so nothing is sent to the API.
  payload: EmailDraftPayload | null;
  isSaving: boolean;
  isSendingTest: boolean;
  // The failure to show above the footer buttons.
  footerError: string | null;
  save: () => void;
  sendTest: () => void;
  // Forgets the failure lines; every way of closing goes through it.
  reset: () => void;
};

export function useEmailEditor({
  section,
  saved,
  isOpen,
  onSaved,
}: UseEmailEditorOptions): EmailEditor {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const me = useQuery(meQueries.detail());
  const [subject, setSubject] = useState(saved.subject);
  const [body, setBody] = useState(saved.body);
  const [brandColor, setBrandColor] = useState(saved.brandColor);
  const [view, setView] = useState<EmailEditorView>("edit");
  const [wasOpen, setWasOpen] = useState(isOpen);

  // Opening starts from what is saved, wherever the last edit left off.
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setSubject(saved.subject);
      setBody(saved.body);
      setBrandColor(saved.brandColor);
      setView("edit");
    }
  }

  const saveMutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: (updated) => {
      queryClient.setQueryData(settingQueries.page().queryKey, updated);
      onSaved();
      showToast({ tone: "success", message: `${section.title} email saved.` });
    },
  });
  const testMutation = useMutation({
    mutationFn: sendTestEmail,
    onSuccess: () => {
      const email = me.data?.email;
      showToast({
        tone: "success",
        message: email ? `Test sent to ${email}.` : "Test sent.",
      });
    },
  });

  const templateError = validateTemplate(section, subject, body);
  const colourError = validateBrandColor(cleanBrandColor(brandColor));
  const isInvalid = templateError !== null || colourError !== null;
  const isColourChanged =
    normalizeBrandColor(brandColor) !== normalizeBrandColor(saved.brandColor);
  const isChanged =
    subject !== saved.subject || body !== saved.body || isColourChanged;
  const payload = isInvalid
    ? null
    : draftEmailPayload(section, subject, body, brandColor);

  // A new edit makes an old failure line stale.
  function edited<T>(setter: (value: T) => void): (value: T) => void {
    return (value) => {
      setter(value);
      saveMutation.reset();
      testMutation.reset();
    };
  }

  function save(): void {
    if (isInvalid || !isChanged || saveMutation.isPending) return;
    saveMutation.mutate([
      { key: section.keys.subject, value: subject },
      { key: section.keys.body, value: body },
      { key: section.brandColorKey, value: normalizeBrandColor(brandColor) },
    ]);
  }

  function sendTest(): void {
    if (payload === null || testMutation.isPending) return;
    testMutation.mutate(payload);
  }

  function reset(): void {
    saveMutation.reset();
    testMutation.reset();
  }

  let footerError: string | null = null;
  if (saveMutation.isError) {
    footerError = SAVE_FAILED;
  } else if (testMutation.isError) {
    footerError = TEST_FAILED;
  }

  return {
    subject,
    body,
    brandColor,
    view,
    setSubject: edited(setSubject),
    setBody: edited(setBody),
    setBrandColor: edited(setBrandColor),
    setView,
    templateError,
    colourError,
    isColourChanged,
    isChanged,
    isInvalid,
    payload,
    isSaving: saveMutation.isPending,
    isSendingTest: testMutation.isPending,
    footerError,
    save,
    sendTest,
    reset,
  };
}
