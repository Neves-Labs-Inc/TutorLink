// The "Delete older chats?" check before a Save that would shorten how
// long chats are kept. The save runs only on confirm.
import type { ReactNode } from "react";
import { BUSINESS_TIME_ZONE } from "@/components/kit/format";
import { formatDuration } from "@/components/kit/lib/units";
import { ConfirmDialog } from "@/components/kit/overlays/dialog";
import { RETENTION_UNITS } from "@/lib/settings/duration-units";
import {
  formatHour,
  getNextCleanUp,
  getZoneAbbreviation,
  utcToZoneHour,
} from "@/lib/settings/office-time";
import {
  BUSINESS_TIMEZONE_KEY,
  PURGE_HOUR_KEY,
  RETENTION_KEY,
} from "@/lib/settings/settings-groups";
import type { SettingsForm } from "@/pages/settings/hooks/use-settings-form";

type RetentionConfirmProps = {
  form: SettingsForm;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export default function RetentionConfirm({
  form,
  isOpen,
  onClose,
  onConfirm,
}: RetentionConfirmProps): ReactNode {
  const zone = form.valueOf(BUSINESS_TIMEZONE_KEY) || BUSINESS_TIME_ZONE;
  const now = new Date();
  const purgeHour = utcToZoneHour(
    Number(form.valueOf(PURGE_HOUR_KEY)),
    zone,
    now,
  );
  const period = formatDuration(
    Number(form.valueOf(RETENTION_KEY)),
    RETENTION_UNITS,
  );

  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title="Delete older chats?"
      confirmLabel="Save and delete"
      keepLabel="Keep editing"
      isDestructive
      isKeepFocused
    >
      Messages older than {period} will be deleted at the next clean-up,{" "}
      {getNextCleanUp(purgeHour, zone, now)} at {formatHour(purgeHour)}{" "}
      {getZoneAbbreviation(zone, now)}. Chats left empty go too. This can’t be
      undone.
    </ConfirmDialog>
  );
}
