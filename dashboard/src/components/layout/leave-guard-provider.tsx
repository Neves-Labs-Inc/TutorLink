// The shell's half of the leave guard: holds what the page registered,
// owns the one "Leave without saving?" dialog every nav reaches, and the
// browser's own prompt on reload or close while anything is unsaved.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { pluralize } from "@/components/kit/format";
import { ConfirmDialog } from "@/components/kit/overlays/dialog";
import { LeaveGuardContext } from "@/hooks/use-leave-guard";
import type { LeaveGuardApi, LeaveGuardEntry } from "@/hooks/use-leave-guard";

type Guard = { token: symbol; entry: LeaveGuardEntry };

type LeaveGuardProviderProps = { children: ReactNode };

export default function LeaveGuardProvider({
  children,
}: LeaveGuardProviderProps): ReactNode {
  const navigate = useNavigate();
  const [guard, setGuardState] = useState<Guard | null>(null);
  // Where the person tried to go while the dialog asks.
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const isDirty = guard !== null;

  const setGuard = useCallback(
    (token: symbol, entry: LeaveGuardEntry | null) => {
      setGuardState((current) => {
        if (entry) return { token, entry };
        return current?.token === token ? null : current;
      });
    },
    [],
  );

  const guardedNavigate = useCallback(
    (to: string) => {
      if (isDirty) {
        setPendingPath(to);
      } else {
        navigate(to);
      }
    },
    [isDirty, navigate],
  );

  const api = useMemo<LeaveGuardApi>(
    () => ({ setGuard, navigate: guardedNavigate }),
    [setGuard, guardedNavigate],
  );

  useEffect(() => {
    if (!isDirty) return;
    function handleBeforeUnload(event: BeforeUnloadEvent): void {
      event.preventDefault();
      // Older Safari only shows the prompt when returnValue is set.
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  function handleDiscard(): void {
    guard?.entry.onDiscard();
    setPendingPath(null);
    if (pendingPath !== null) navigate(pendingPath);
  }

  const changeCount = guard?.entry.changeCount ?? 0;
  return (
    <LeaveGuardContext.Provider value={api}>
      {children}
      <ConfirmDialog
        isOpen={pendingPath !== null}
        onClose={() => setPendingPath(null)}
        onConfirm={handleDiscard}
        title="Leave without saving?"
        confirmLabel="Discard changes"
        keepLabel="Keep editing"
        isDestructive
        isKeepFocused
      >
        You have{" "}
        {pluralize(changeCount, "unsaved change", "unsaved changes")} in{" "}
        {guard?.entry.where}. If you leave now, they’re lost.
      </ConfirmDialog>
    </LeaveGuardContext.Provider>
  );
}
