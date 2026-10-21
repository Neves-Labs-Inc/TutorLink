// Who takes the session: the Staff picker with each one's day, the
// Assigned Tutor warning under it, and Change booking's swap box when the
// Booking's Staff member is off or archived.
import type { ReactNode } from "react";
import { Plane, UserRoundX } from "lucide-react";
import { formatClock } from "@/components/kit/format";
import { Button, TextLink } from "@/components/kit/components/button";
import { Combobox } from "@/components/kit/components/combobox";
import type { BookingFormState } from "@/hooks/use-booking-form";
import { getFirstName } from "@/lib/bookings/booking-details";

const STAFF_LOAD_FAILED =
  "Couldn’t load the Staff list. Check your connection and try again.";

type BookingStaffFieldProps = { form: BookingFormState };

export default function BookingStaffField({
  form,
}: BookingStaffFieldProps): ReactNode {
  const { fields, staff, booking, swap } = form;
  const isEvaluation = fields.kind === "evaluation";
  const archivedHelp =
    booking && form.isStaffArchived && fields.userId === null
      ? `${booking.staff.name} can’t take this booking any more. Pick someone else.`
      : undefined;

  return (
    <>
      <div data-field="staff" className="flex flex-col gap-1">
        <Combobox
          label="Staff"
          placeholder={isEvaluation ? "Pick an Admin or Manager" : "Search Staff"}
          value={fields.userId}
          onChange={form.setStaff}
          isDisabled={staff.isLoading}
          error={form.errors.staff ?? (staff.isError ? STAFF_LOAD_FAILED : undefined)}
          help={archivedHelp}
          options={staff.items.map((choice) => ({
            value: choice.staff.id,
            label: choice.staff.name,
            description: choice.description,
            hasAvatar: true,
          }))}
        />
        {staff.isError && (
          <TextLink onClick={staff.retry} className="self-start px-1 text-[13px]">
            Try again
          </TextLink>
        )}
      </div>
      {form.assignedTutorNote && (
        <p
          role="status"
          className="kit-rise flex items-start gap-2 rounded-[16px] bg-(--tl-warning-tint) px-4 py-3 text-[14px] leading-5 text-(--tl-warning)"
        >
          <UserRoundX aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{form.assignedTutorNote}</span>
        </p>
      )}
      {swap && (
        <div className="kit-rise rounded-[16px] bg-(--tl-yellow-tint) p-4 text-(--tl-yellow-ink)">
          <p className="flex items-center gap-2 text-[14px] font-semibold">
            <Plane aria-hidden className="size-4 shrink-0" />
            {getFirstName(swap.staffName)} is off. Free at {formatClock(swap.startTime)}:
          </p>
          {swap.options.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {swap.options.map((option) => (
                <Button
                  key={option.id}
                  variant="outline"
                  onClick={() => form.setStaff(option.id)}
                >
                  {option.name}
                </Button>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-[14px]">
              Nobody else is free at {formatClock(swap.startTime)}. Pick another time.
            </p>
          )}
        </div>
      )}
    </>
  );
}
