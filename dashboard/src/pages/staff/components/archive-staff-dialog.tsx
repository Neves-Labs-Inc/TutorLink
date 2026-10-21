// Archive's confirm: what waits for the office (upcoming Bookings) and
// what is lost for good (Assigned Tutor links). The confirm stays off
// until the Booking count is in.
import type { ReactNode } from "react";
import { TextLink } from "@/components/kit/components/button";
import { pluralize } from "@/components/kit/format";
import { ConfirmDialog } from "@/components/kit/overlays/dialog";
import { Skeleton } from "@/components/kit/states/states";
import type { StaffRead } from "@/lib/queries/staff";
import type { StaffArchive } from "@/pages/staff/hooks/use-staff-archive";

const ALERT_LINE = "text-[14px] leading-5 font-medium text-(--tl-danger)";

type ArchiveBodyProps = { staff: StaffRead; archive: StaffArchive };

function ArchiveBody({ staff, archive }: ArchiveBodyProps): ReactNode {
  const childCount = staff.assigned_children.length;
  let body: ReactNode;
  if (archive.hasCountFailed) {
    body = (
      <p role="alert" className={ALERT_LINE}>
        Couldn’t check their upcoming Bookings.{" "}
        <TextLink
          onClick={archive.retryCount}
          disabled={archive.isRetryingCount}
        >
          Try again
        </TextLink>
      </p>
    );
  } else if (archive.upcomingCount === undefined) {
    body = (
      <div aria-busy="true" className="flex flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  } else {
    body = (
      <>
        {archive.upcomingCount > 0 && (
          <p>
            <strong>
              {pluralize(
                archive.upcomingCount,
                "upcoming Booking",
                "upcoming Bookings",
              )}
            </strong>{" "}
            {archive.upcomingCount === 1
              ? "is with them. Nothing is cancelled: it waits in To do for you to Change booking."
              : "are with them. Nothing is cancelled: they wait in To do for you to Change booking."}
          </p>
        )}
        {childCount > 0 && (
          <p>
            They stop being an Assigned Tutor of{" "}
            <strong>{pluralize(childCount, "Child", "Children")}</strong>.
            Restore doesn’t bring that back.
          </p>
        )}
        <p>
          They can’t sign in or be booked any more. Restore brings them back.
        </p>
      </>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {body}
      {archive.failure && (
        <p role="alert" className={ALERT_LINE}>
          {archive.failure}
        </p>
      )}
    </div>
  );
}

type ArchiveStaffDialogProps = { staff: StaffRead; archive: StaffArchive };

export default function ArchiveStaffDialog({
  staff,
  archive,
}: ArchiveStaffDialogProps): ReactNode {
  return (
    <ConfirmDialog
      isOpen={archive.isConfirming}
      onClose={archive.cancel}
      onConfirm={archive.confirm}
      title={`Archive ${staff.name}?`}
      confirmLabel="Archive"
      keepLabel="Keep"
      isDestructive
      isWorking={archive.isArchiving}
      isConfirmDisabled={archive.upcomingCount === undefined}
    >
      <ArchiveBody staff={staff} archive={archive} />
    </ConfirmDialog>
  );
}
