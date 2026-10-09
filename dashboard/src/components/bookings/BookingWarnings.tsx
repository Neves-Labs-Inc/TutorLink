import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

type BookingWarningsProps = {
  messages: string[];
};

// The confirmable warnings of a booking write, server and client lines alike. The `pending`
// status pair is the sanctioned exception to "status tones through StatusBadge only"
// (DESIGN.md §2): a warning waits on the Office. Stays mounted while the list changes so a
// resubmit swaps the lines without re-animating.
export default function BookingWarnings({
  messages,
}: BookingWarningsProps): ReactNode {
  if (messages.length === 0) return null;

  return (
    <div
      role="status"
      className="flex gap-2 rounded-lg border border-status-pending bg-status-pending-bg p-2.5 text-xs text-status-pending animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none"
    >
      <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
      <ul className="space-y-1">
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  );
}
