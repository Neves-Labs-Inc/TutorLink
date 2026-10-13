// Time off. Tutors and Managers see their own requests and "Request time
// off" (a bottom sheet); an Admin approves or declines. Admins see the
// whole queue instead (time-off-queue.tsx).
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Plane, Plus } from "lucide-react";
import { CURRENT_USER, TIME_OFF } from "@/pages/prototype/shell-kit/kit/mock-data";
import type { Role, TimeOff } from "@/pages/prototype/shell-kit/kit/mock-data";
import { CARD, cn } from "@/pages/prototype/shell-kit/kit/tokens";
import { TimeOffBadge } from "@/pages/prototype/shell-kit/kit/components/badges";
import { Button, TextLink } from "@/pages/prototype/shell-kit/kit/components/button";
import { SwitchField } from "@/pages/prototype/shell-kit/kit/components/choices";
import {
  TextAreaField,
  TextField,
} from "@/pages/prototype/shell-kit/kit/components/fields";
import { PageHeader } from "@/pages/prototype/shell-kit/kit/shell/page-header";
import { BottomSheet } from "@/pages/prototype/shell-kit/kit/overlays/bottom-sheet";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";
import { EmptyState } from "@/pages/prototype/shell-kit/kit/states/states";
import TimeOffQueue from "@/pages/prototype/shell-kit/screens/shell-pages/time-off-queue";

const FORM_ID = "time-off-form";

type TimeOffPageProps = { role: Role };

// Tutors and Managers: their own requests. Admins get the queue.
export default function TimeOffPage({ role }: TimeOffPageProps): ReactNode {
  return role === "admin" ? <TimeOffQueue /> : <OwnTimeOff role={role} />;
}

function OwnTimeOff({ role }: TimeOffPageProps): ReactNode {
  const user = CURRENT_USER[role];
  const [requests, setRequests] = useState<TimeOff[]>(() =>
    TIME_OFF.filter((item) => item.staff === user.name),
  );
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isPartDay, setIsPartDay] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [hasTriedSubmit, setHasTriedSubmit] = useState(false);
  const { showToast } = useToast();
  const dateError =
    hasTriedSubmit && startDate === "" ? "Pick the first day you’re off." : undefined;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setHasTriedSubmit(true);
    if (startDate === "") return;
    const request: TimeOff = {
      id: `new-${requests.length}`,
      staff: user.name,
      staffRole: user.role,
      range: new Date(`${startDate}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      reason: "New request",
      status: "Pending",
      timing: "upcoming",
    };
    setRequests([request, ...requests]);
    setIsSheetOpen(false);
    setStartDate("");
    setHasTriedSubmit(false);
    showToast({
      tone: "success",
      message: "Request sent. An Admin will approve or decline it.",
    });
  }

  function handleCancel(request: TimeOff): void {
    const before = requests;
    setRequests(
      requests.map((item) =>
        item.id === request.id ? { ...item, status: "Cancelled" } : item,
      ),
    );
    showToast({
      tone: "success",
      message: `Time off for ${request.range} cancelled.`,
      actionLabel: "Undo",
      onAction: () => setRequests(before),
    });
  }

  return (
    <>
      <PageHeader
        title="Time off"
        description="Days you can’t be booked. An Admin approves each request."
        primaryAction={{
          label: "Request time off",
          icon: Plus,
          onClick: () => setIsSheetOpen(true),
        }}
      />
      {requests.length === 0 ? (
        <EmptyState
          icon={Plane}
          tone="yellow"
          title="No time off yet"
          body="Request days or part of a day off. You’ll see here when an Admin approves it."
          action={
            <Button variant="primary" icon={Plus} onClick={() => setIsSheetOpen(true)}>
              Request time off
            </Button>
          }
        />
      ) : (
        <ul className={cn(CARD, "divide-y divide-(--tl-border) overflow-hidden")}>
          {requests.map((request) => (
            <li
              key={request.id}
              className="flex min-h-[76px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 @2xl:px-6"
            >
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-(--tl-yellow-tint) text-(--tl-yellow-ink)">
                <Plane aria-hidden className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold tabular-nums">
                  {request.range}
                </span>
                <span className="block text-[13px] text-(--tl-muted)">
                  {request.reason}
                </span>
              </span>
              <TimeOffBadge status={request.status} />
              {(request.status === "Pending" || request.status === "Approved") && (
                <TextLink onClick={() => handleCancel(request)}>Cancel</TextLink>
              )}
            </li>
          ))}
        </ul>
      )}
      <BottomSheet
        isOpen={isSheetOpen}
        onClose={() => setIsSheetOpen(false)}
        title="Request time off"
        description="An Admin approves or declines it. You’ll see the answer here."
        footer={
          <>
            <Button onClick={() => setIsSheetOpen(false)}>Not now</Button>
            <Button variant="primary" type="submit" form={FORM_ID}>
              Send request
            </Button>
          </>
        }
      >
        <form
          id={FORM_ID}
          noValidate
          onSubmit={handleSubmit}
          className="flex flex-col gap-5"
        >
          <div className="grid gap-5 @md:grid-cols-2">
            <TextField
              label="First day"
              type="date"
              required
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              error={dateError}
            />
            <TextField label="Last day" type="date" help="Leave empty for one day." />
          </div>
          <SwitchField
            label="Only part of the day"
            isOn={isPartDay}
            onChange={setIsPartDay}
          />
          {isPartDay && (
            <div className="grid grid-cols-2 gap-5">
              <TextField label="From" type="time" defaultValue="13:00" />
              <TextField label="To" type="time" defaultValue="17:00" />
            </div>
          )}
          <TextAreaField
            label="Reason"
            help="Optional. Only the office sees it."
            rows={3}
          />
        </form>
      </BottomSheet>
    </>
  );
}
