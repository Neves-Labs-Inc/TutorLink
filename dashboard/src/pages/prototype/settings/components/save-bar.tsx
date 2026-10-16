// One Save bar for the whole page (audit O39: no more per-card bars). It
// floats at the bottom while anything is unsaved, above the phone tab
// bar, and names how many fields changed.
import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import { cn } from "@/pages/prototype/shell-kit/kit/tokens";
import { pluralize } from "@/pages/prototype/shell-kit/kit/format";
import type { SaveState } from "@/pages/prototype/settings/hooks/use-settings";

type SaveBarProps = {
  changeCount: number;
  hasErrors: boolean;
  saveState: SaveState;
  onSave: () => void;
  onDiscard: () => void;
};

export default function SaveBar({
  changeCount,
  hasErrors,
  saveState,
  onSave,
  onDiscard,
}: SaveBarProps): ReactNode {
  if (changeCount === 0) return null;
  const isSaving = saveState === "saving";
  let message = pluralize(changeCount, "unsaved change", "unsaved changes");
  if (hasErrors) message = "Fix the highlighted field to save.";
  if (saveState === "failed") {
    message = "Couldn't save. Check your connection and try again.";
  }
  const isProblem = hasErrors || saveState === "failed";

  return (
    <div className="sticky bottom-[92px] z-10 mt-6 @5xl:bottom-6">
      <div
        role="region"
        aria-label="Unsaved changes"
        className="kit-shadow-raised flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[24px] border border-(--tl-card-border) bg-(--tl-surface) p-2 pl-5"
      >
        <p
          role="status"
          className={cn(
            "flex min-w-0 flex-1 basis-[180px] items-center gap-2 text-[14px] leading-5 font-semibold",
            isProblem ? "text-(--tl-danger)" : "text-(--tl-ink)",
          )}
        >
          {isProblem && <CircleAlert aria-hidden className="size-4 shrink-0" />}
          {message}
        </p>
        <span className="flex flex-1 justify-end gap-2">
          <Button variant="ghost" onClick={onDiscard} disabled={isSaving}>
            Discard
          </Button>
          <Button
            variant="primary"
            onClick={onSave}
            disabled={hasErrors}
            isLoading={isSaving}
          >
            {isSaving ? "Saving…" : "Save changes"}
          </Button>
        </span>
      </div>
    </div>
  );
}
