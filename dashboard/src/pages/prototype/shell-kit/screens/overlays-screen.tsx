// screen=overlays: detail overlay (the phone fork: A pushed page / B
// bottom sheet), bottom sheet, dialogs, and toasts.
import { useState } from "react";
import type { ReactNode } from "react";
import {
  CalendarDays,
  CheckCheck,
  ListOrdered,
  PanelRight,
  Rows3,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { BOOKINGS, STAFF } from "@/pages/prototype/shell-kit/kit/mock-data";
import type { Booking, Staff } from "@/pages/prototype/shell-kit/kit/mock-data";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import { CheckboxField } from "@/pages/prototype/shell-kit/kit/components/choices";
import { BottomSheet } from "@/pages/prototype/shell-kit/kit/overlays/bottom-sheet";
import type { PhoneDetailMode } from "@/pages/prototype/shell-kit/kit/overlays/detail-overlay";
import { ConfirmDialog } from "@/pages/prototype/shell-kit/kit/overlays/dialog";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";
import BookingDetail from "@/pages/prototype/shell-kit/screens/booking-detail";
import { Gallery, Specimen } from "@/pages/prototype/shell-kit/screens/gallery";
import StaffDetail from "@/pages/prototype/shell-kit/screens/staff-detail";
import WeekDetail from "@/pages/prototype/shell-kit/screens/week-detail";

const SAMPLE_BOOKING = BOOKINGS.find((booking) => booking.id === "b04") ?? BOOKINGS[0];
const SAMPLE_STAFF = STAFF.find((staff) => staff.signIn === "Invited") ?? STAFF[0];
const FAKE_SAVE_MS = 900;
const TUTORS = ["Ana Ruiz", "Marco Diaz", "Priya Patel", "Jordan Blake"];

type OverlaysScreenProps = { phoneMode: PhoneDetailMode };

export default function OverlaysScreen({
  phoneMode,
}: OverlaysScreenProps): ReactNode {
  const [booking, setBooking] = useState<Booking | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [isWeekOpen, setIsWeekOpen] = useState(false);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [tutors, setTutors] = useState<string[]>(["Ana Ruiz"]);
  const [isMarkOpen, setIsMarkOpen] = useState(false);
  const [isMarking, setIsMarking] = useState(false);
  const { showToast } = useToast();

  function handleMarkEvaluated(): void {
    setIsMarking(true);
    window.setTimeout(() => {
      setIsMarking(false);
      setIsMarkOpen(false);
      showToast({ tone: "success", message: "Daniel Ortiz marked Evaluated." });
    }, FAKE_SAVE_MS);
  }

  function toggleTutor(name: string): void {
    setTutors((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name],
    );
  }

  const forkNote =
    phoneMode === "page"
      ? "On phones the details push in from the right as a full page, with Back ← at the top."
      : "Archived variant B: on phones the details rise as a bottom sheet.";

  return (
    <Gallery
      title="Overlays"
      intro="Desktop and tablet use a slide-over for details; phones push a full page. Escape closes any overlay and focus returns to what opened it."
    >
      <Specimen
        title="Detail: slide-over / pushed page"
        note={`${forkNote} From 672px wide it is always a slide-over.`}
      >
        <div className="flex flex-wrap gap-3">
          <Button
            variant="primary"
            icon={CalendarDays}
            onClick={() => setBooking(SAMPLE_BOOKING)}
          >
            Open a Booking
          </Button>
          <Button icon={UserRound} onClick={() => setStaff(SAMPLE_STAFF)}>
            Open a Staff member
          </Button>
        </div>
      </Specimen>
      <Specimen
        title="Detail: pinned header"
        note="For long details (a chat thread, a long Booking): the header and close stay at the top while the content scrolls under them."
      >
        <Button icon={ListOrdered} onClick={() => setIsWeekOpen(true)}>
          Open this week’s Bookings
        </Button>
      </Specimen>
      <Specimen
        title="Bottom sheet"
        note="For short tasks: filters, pickers, the account menu. A centred card from 672px."
      >
        <Button icon={Rows3} onClick={() => setIsSheetOpen(true)}>
          Filter by Staff
        </Button>
      </Specimen>
      <Specimen
        title="Dialogs"
        note="Confirm only what can’t be undone easily. Both buttons name the act."
      >
        <div className="flex flex-wrap gap-3">
          <Button icon={CheckCheck} onClick={() => setIsMarkOpen(true)}>
            Mark Evaluated
          </Button>
          <Button
            variant="danger-outline"
            icon={TriangleAlert}
            onClick={() => setBooking(SAMPLE_BOOKING)}
          >
            Cancel booking (via details)
          </Button>
        </div>
      </Specimen>
      <Specimen
        title="Toasts"
        note="Bottom-right on desktop, above the tab bar on phones. Errors stay longer and offer the fix."
      >
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() =>
              showToast({ tone: "success", message: "Booking changed." })
            }
          >
            Success
          </Button>
          <Button
            onClick={() =>
              showToast({
                tone: "success",
                message: "Approved time off for Marco Diaz.",
                actionLabel: "Undo",
                onAction: () =>
                  showToast({ tone: "info", message: "Back in To do." }),
              })
            }
          >
            Success with Undo
          </Button>
          <Button
            onClick={() =>
              showToast({
                tone: "error",
                message: "Couldn’t save. Check your connection.",
                actionLabel: "Retry",
                onAction: () =>
                  showToast({ tone: "success", message: "Saved." }),
              })
            }
          >
            Error with Retry
          </Button>
          <Button
            icon={PanelRight}
            onClick={() =>
              showToast({ tone: "info", message: "Maria Lopez took over this chat." })
            }
          >
            Info
          </Button>
        </div>
      </Specimen>

      <BookingDetail
        booking={booking}
        onClose={() => setBooking(null)}
        phoneMode={phoneMode}
        backLabel="Overlays"
      />
      <StaffDetail
        staff={staff}
        onClose={() => setStaff(null)}
        phoneMode={phoneMode}
      />
      <WeekDetail
        isOpen={isWeekOpen}
        onClose={() => setIsWeekOpen(false)}
        phoneMode={phoneMode}
      />
      <BottomSheet
        isOpen={isSheetOpen}
        onClose={() => setIsSheetOpen(false)}
        title="Filter by Staff"
        description="Show only Bookings with these people."
        footer={
          <>
            <Button variant="ghost" onClick={() => setTutors([])}>
              Clear all
            </Button>
            <Button variant="primary" onClick={() => setIsSheetOpen(false)}>
              Show results
            </Button>
          </>
        }
      >
        <div className="flex flex-col">
          {TUTORS.map((name) => (
            <CheckboxField
              key={name}
              label={name}
              isChecked={tutors.includes(name)}
              onChange={() => toggleTutor(name)}
            />
          ))}
        </div>
      </BottomSheet>
      <ConfirmDialog
        isOpen={isMarkOpen}
        onClose={() => setIsMarkOpen(false)}
        onConfirm={handleMarkEvaluated}
        title="Mark Daniel Ortiz Evaluated?"
        confirmLabel="Mark Evaluated"
        keepLabel="Not yet"
        isWorking={isMarking}
      >
        Once Evaluated, Patricia Ortiz can book Daniel through the bot.
      </ConfirmDialog>
    </Gallery>
  );
}
