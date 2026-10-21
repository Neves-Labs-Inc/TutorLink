// One warning callout per Needs attention reason, in the order the API
// sends them, each saying why and what to do.
import type { ReactNode } from "react";
import { BOOKING_REASON } from "@/components/kit/lib/booking-reason";
import { CARD_TITLE, cn } from "@/components/kit/tokens";
import { describeTimeOff } from "@/lib/bookings/booking-details";
import type { BookingDetail, SortOutReason } from "@/lib/queries/bookings";

function getReasonCopy(reason: SortOutReason, staff: string): string {
  const copy: Record<SortOutReason, string> = {
    not_completed:
      "Its date has passed and nobody has marked it. Say whether it happened.",
    time_off_clash: `${staff} has approved Time off then. Change the booking, or keep it if they’ll still teach it.`,
    archived_staff: `${staff} is archived. Give the booking to someone else, or cancel it.`,
  };
  return copy[reason];
}

type BookingReasonCalloutsProps = {
  booking: BookingDetail;
  canKeep: boolean;
};

export default function BookingReasonCallouts({
  booking,
  canKeep,
}: BookingReasonCalloutsProps): ReactNode {
  if (booking.sort_out_reasons.length === 0) return null;

  return (
    <section aria-label="Needs attention" className="flex flex-col gap-2">
      {booking.sort_out_reasons.map((reason) => {
        const { icon: Icon, label } = BOOKING_REASON[reason];
        const isClash = reason === "time_off_clash";
        return (
          <div
            key={reason}
            className="kit-fade rounded-[16px] bg-(--tl-warning-tint) p-4 text-(--tl-warning)"
          >
            <p className={cn(CARD_TITLE, "flex items-center gap-2")}>
              <Icon aria-hidden className="size-[18px] shrink-0" />
              {label}
            </p>
            <p className="mt-1 text-[14px] leading-5">
              {getReasonCopy(reason, booking.staff.name)}
            </p>
            {isClash &&
              booking.clashing_time_off.map((timeOff) => (
                <p
                  key={timeOff.id}
                  className="mt-1 text-[13px] leading-[18px] tabular-nums"
                >
                  {describeTimeOff(timeOff)}
                </p>
              ))}
            {isClash && !canKeep && (
              <p className="mt-1 text-[13px] leading-[18px]">
                Only an Admin can keep a booking over Time off.
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}
