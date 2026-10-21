// The Bookings inside the dates, while the Time off is pending (not
// Expired) or approved. The owner, a Tutor or Manager, reads them as
// their sessions; everyone else as Bookings.
import type { ReactNode } from "react";
import { CalendarX2 } from "lucide-react";
import { pluralize } from "@/components/kit/format";
import { CARD_TITLE, cn } from "@/components/kit/tokens";
import type { ExceptionRead } from "@/lib/queries/time-off";
import { formatBookingStart } from "@/pages/time-off/lib/time-off-copy";
import { isAdminViewer } from "@/pages/time-off/lib/time-off-rules";
import type { Viewer } from "@/pages/time-off/lib/time-off-rules";

type TimeOffClashBlockProps = { item: ExceptionRead; viewer: Viewer };

function getNote(item: ExceptionRead, isAdmin: boolean): string {
  let note = "If it’s approved, the office will change or keep them.";
  if (isAdmin && item.status === "pending") {
    note = "Approving keeps them and puts them in To do, to change or keep.";
  } else if (item.status === "approved") {
    note = "They wait in To do for the office to change or keep.";
  }
  return note;
}

export default function TimeOffClashBlock({
  item,
  viewer,
}: TimeOffClashBlockProps): ReactNode {
  const isAdmin = isAdminViewer(viewer);
  const isOwnerView = item.staff.id === viewer.id && !isAdmin;
  const [one, many] = isOwnerView
    ? ["session", "sessions"]
    : ["Booking", "Bookings"];
  const count = item.clashing_bookings_count;
  const hasClashes = count > 0;
  return (
    <section
      data-has-clashes={hasClashes}
      className={cn(
        "rounded-[16px] p-4",
        hasClashes
          ? "bg-(--tl-warning-tint) text-(--tl-warning)"
          : "bg-(--tl-surface-sunk) text-(--tl-muted)",
      )}
    >
      <h3 className={cn(CARD_TITLE, "flex items-center gap-2")}>
        <CalendarX2 aria-hidden className="size-[18px] shrink-0" />
        {hasClashes
          ? `${pluralize(count, one, many)} in these dates`
          : `No ${many} in these dates`}
      </h3>
      {hasClashes && (
        <>
          <ul className="mt-2 flex flex-col gap-1.5 text-[14px] leading-5 text-(--tl-ink)">
            {item.clashing_bookings.map((booking) => (
              <li key={booking.booking_id} className="tabular-nums">
                <span className="font-semibold">{booking.child_name}</span>
                {" · "}
                {formatBookingStart(booking.date, booking.start_time)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] leading-[18px]">
            {getNote(item, isAdmin)}
          </p>
        </>
      )}
    </section>
  );
}
