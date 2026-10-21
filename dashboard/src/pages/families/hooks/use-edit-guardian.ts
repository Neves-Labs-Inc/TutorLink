// Edit Guardian's form: name and number go through PATCH /api/clients,
// the Guardian language through PATCH /api/conversations (it lives on
// their chat). Only changed fields are sent; each refusal lands on the
// field it is about, and anything else on the sheet's failure line.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/components/kit/overlays/use-toast";
import { errorDetail, errorStatus } from "@/lib/api";
import { familyMutations } from "@/lib/queries/families";
import type { ClientRead, ClientUpdate, Language } from "@/types/families";

const BAD_REQUEST = 400;
const CONFLICT = 409;
// clients.py's WHATSAPP_CHAT_TAKEN_ERROR; the other 409 is the number.
const CHAT_TAKEN_DETAIL = /WhatsApp chat/i;

const NAME_REQUIRED = "Enter the Guardian’s name.";
const PHONE_REQUIRED = "Enter the Guardian’s WhatsApp number.";
const PHONE_TAKEN = "Another Guardian already has this number.";
const CHAT_TAKEN = "That number’s WhatsApp chat belongs to another Guardian.";
const PHONE_INVALID =
  "Enter a WhatsApp number the bot can reach, with country code.";
const LANGUAGE_FAILED =
  "Saved the name and number, but not the language. Try again.";
const SAVE_FAILED = "Couldn’t save. Check your connection and try again.";

export type GuardianForm = { name: string; phone: string; language: Language };

export type EditGuardianErrors = {
  name?: string;
  phone?: string;
  form?: string;
};

export type EditGuardian = {
  form: GuardianForm;
  errors: EditGuardianErrors;
  isSaving: boolean;
  hasChat: boolean;
  setField: <K extends keyof GuardianForm>(key: K, value: GuardianForm[K]) => void;
  save: () => Promise<void>;
};

function getInitialForm(guardian: ClientRead): GuardianForm {
  return {
    name: guardian.name,
    phone: guardian.phone_number,
    language: guardian.language ?? "en",
  };
}

function getRequiredErrors(form: GuardianForm): EditGuardianErrors {
  return {
    ...(form.name.trim() === "" && { name: NAME_REQUIRED }),
    ...(form.phone.trim() === "" && { phone: PHONE_REQUIRED }),
  };
}

function getChanges(guardian: ClientRead, form: GuardianForm): ClientUpdate {
  const name = form.name.trim();
  const phone = form.phone.trim();
  return {
    ...(name !== guardian.name && { name }),
    ...(phone !== guardian.phone_number && { phone_number: phone }),
  };
}

// A refused PATCH /api/clients, worded for the field it is about.
function getClientErrors(error: unknown): EditGuardianErrors {
  const status = errorStatus(error);
  let errors: EditGuardianErrors = { form: SAVE_FAILED };
  if (status === CONFLICT) {
    const isChat = CHAT_TAKEN_DETAIL.test(errorDetail(error) ?? "");
    errors = { phone: isChat ? CHAT_TAKEN : PHONE_TAKEN };
  } else if (status === BAD_REQUEST) {
    errors = { phone: PHONE_INVALID };
  }
  return errors;
}

export function useEditGuardian(
  guardian: ClientRead,
  onSaved: () => void,
): EditGuardian {
  const { showToast } = useToast();
  const [form, setForm] = useState(() => getInitialForm(guardian));
  const [errors, setErrors] = useState<EditGuardianErrors>({});
  const updateGuardian = useMutation(familyMutations.updateGuardian());
  const setLanguage = useMutation(familyMutations.setLanguage());
  const conversationId = guardian.language_conversation_id;

  async function saveClient(changes: ClientUpdate): Promise<boolean> {
    let isSaved = true;
    try {
      await updateGuardian.mutateAsync({ guardianId: guardian.id, changes });
    } catch (error) {
      setErrors(getClientErrors(error));
      isSaved = false;
    }
    return isSaved;
  }

  async function saveLanguage(
    chatId: string,
    hasSavedClient: boolean,
  ): Promise<boolean> {
    let isSaved = true;
    try {
      await setLanguage.mutateAsync({
        conversationId: chatId,
        language: form.language,
      });
    } catch {
      setErrors({ form: hasSavedClient ? LANGUAGE_FAILED : SAVE_FAILED });
      isSaved = false;
    }
    return isSaved;
  }

  async function save(): Promise<void> {
    const required = getRequiredErrors(form);
    setErrors(required);
    if (required.name || required.phone) return;

    const changes = getChanges(guardian, form);
    const hasClientChanges = Object.keys(changes).length > 0;
    const isLanguageChanged =
      conversationId !== null && form.language !== (guardian.language ?? "en");
    let isSaved = true;
    if (hasClientChanges) isSaved = await saveClient(changes);
    if (isSaved && isLanguageChanged && conversationId !== null) {
      isSaved = await saveLanguage(conversationId, hasClientChanges);
    }
    if (isSaved) {
      // Nothing changed: just close.
      if (hasClientChanges || isLanguageChanged) {
        showToast({ tone: "success", message: "Guardian saved." });
      }
      onSaved();
    }
  }

  return {
    form,
    errors,
    isSaving: updateGuardian.isPending || setLanguage.isPending,
    hasChat: conversationId !== null,
    setField: (key, value) => setForm((current) => ({ ...current, [key]: value })),
    save,
  };
}
