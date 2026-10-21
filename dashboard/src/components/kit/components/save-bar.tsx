// One Save bar for the whole page. It floats above the phone tab bar
// while anything is unsaved, and names how many fields changed.
import { useRef } from "react";
import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import { pluralize } from "@/components/kit/format";
import {
  LIST_ENTER_MS,
  RISE,
} from "@/components/kit/overlays/use-enter-animation";
import {
  useHeldWhileClosing,
  usePresence,
} from "@/components/kit/overlays/use-presence";
import { cn } from "@/components/kit/tokens";

export type SaveState = "idle" | "saving" | "failed";

type SaveBarProps = {
  changeCount: number;
  hasErrors: boolean;
  saveState: SaveState;
  onSave: () => void;
  onDiscard: () => void;
};

export function SaveBar({
  changeCount,
  hasErrors,
  saveState,
  onSave,
  onDiscard,
}: SaveBarProps): ReactNode {
  const barRef = useRef<HTMLDivElement>(null);
  const isOpen = changeCount > 0;
  const isPresent = usePresence(isOpen, barRef, RISE, {
    enterMs: LIST_ENTER_MS,
  });
  // The last open values, so the message doesn't read "0 unsaved changes"
  // while the bar leaves.
  const shown = useHeldWhileClosing({ changeCount, hasErrors, saveState }, isOpen);

  if (!isPresent) return null;

  const isSaving = shown.saveState === "saving";
  const isProblem = shown.hasErrors || shown.saveState === "failed";
  let message = pluralize(shown.changeCount, "unsaved change", "unsaved changes");
  if (shown.hasErrors) message = "Fix the highlighted field to save.";
  if (shown.saveState === "failed") {
    message = "Couldn’t save. Check your connection and try again.";
  }

  return (
    <div className="sticky bottom-[92px] z-10 mt-6 @5xl:bottom-6">
      <div
        ref={barRef}
        role="region"
        aria-label="Unsaved changes"
        inert={!isOpen}
        className="kit-shadow-raised flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[28px] border border-(--tl-card-border) bg-(--tl-surface) p-2 pl-5"
      >
        <p
          role="status"
          className={cn(
            "flex min-w-0 flex-1 basis-[140px] items-center gap-2 text-[14px] leading-5 font-semibold",
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
            disabled={shown.hasErrors}
            isLoading={isSaving}
          >
            {isSaving ? "Saving…" : "Save changes"}
          </Button>
        </span>
      </div>
    </div>
  );
}
