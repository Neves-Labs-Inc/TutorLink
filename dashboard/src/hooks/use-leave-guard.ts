// A page with unsaved changes registers them here; the signed-in shell
// then asks before any of its nav (sidebar, tab bar, More, Profile) or a
// guarded in-page link leaves, and the browser asks before a reload or
// close. Browser Back is not caught (BrowserRouter has no blocker).
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

export type LeaveGuardEntry = {
  changeCount: number;
  // Where the changes are, for the dialog: "in Settings".
  where: string;
  onDiscard: () => void;
};

export type LeaveGuardApi = {
  // null clears the guard, unless a newer token has replaced it.
  setGuard: (token: symbol, entry: LeaveGuardEntry | null) => void;
  navigate: (to: string) => void;
};

export const LeaveGuardContext = createContext<LeaveGuardApi | null>(null);

type UseLeaveGuardOptions = LeaveGuardEntry;

// Guards while changeCount > 0. Outside the shell (no provider) it does
// nothing, so a page still renders on its own in tests.
export function useLeaveGuard({
  changeCount,
  where,
  onDiscard,
}: UseLeaveGuardOptions): void {
  const api = useContext(LeaveGuardContext);
  const [token] = useState(() => Symbol("leave-guard"));
  const onDiscardRef = useRef(onDiscard);
  useEffect(() => {
    onDiscardRef.current = onDiscard;
  });
  const setGuard = api?.setGuard;

  useEffect(() => {
    if (!setGuard || changeCount === 0) return;
    setGuard(token, {
      changeCount,
      where,
      onDiscard: () => onDiscardRef.current(),
    });
    return () => setGuard(token, null);
  }, [setGuard, token, changeCount, where]);
}

// navigate() for in-page links that should ask first while a page is dirty.
export function useGuardedNavigate(): (to: string) => void {
  const api = useContext(LeaveGuardContext);
  const navigate = useNavigate();
  return api?.navigate ?? navigate;
}
