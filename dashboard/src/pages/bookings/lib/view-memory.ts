// The List or Calendar choice, kept per device so the next visit opens
// the same view. Calendar until something was chosen.
import type { BookingsView } from "@/pages/bookings/lib/bookings-url";

const VIEW_STORAGE_KEY = "tutorlink.bookings.view";
const DEFAULT_VIEW: BookingsView = "calendar";

export function readStoredView(): BookingsView {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(VIEW_STORAGE_KEY);
  } catch {
    // Storage blocked (private mode, policy): read as "no choice yet".
    raw = null;
  }
  return raw === "list" ? "list" : DEFAULT_VIEW;
}

export function storeView(view: BookingsView): void {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // Storage blocked: the choice still holds for this visit through the URL.
    return;
  }
}
