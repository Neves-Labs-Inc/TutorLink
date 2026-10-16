// An Admin adds Time off for a Staff member (POST
// /api/users/{id}/exceptions). It takes effect straight away: no
// approval step.
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import { SwitchField } from "@/pages/prototype/shell-kit/kit/components/choices";
import { TextField } from "@/pages/prototype/shell-kit/kit/components/fields";
import { BottomSheet } from "@/pages/prototype/shell-kit/kit/overlays/bottom-sheet";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import { TODAY } from "@/pages/prototype/accounts-staff/lib/mock-data";
import type { StaffRead } from "@/pages/prototype/accounts-staff/types/api";

const REASON_MAX = 200;

type AddTimeOffSheetProps = { staff: StaffRead; onClose: () => void };

export default function AddTimeOffSheet({ staff, onClose }: AddTimeOffSheetProps): ReactNode {
  const { addTimeOff } = useArea();
  const { showToast } = useToast();
  const [startDate, setStartDate] = useState(TODAY);
  const [endDate, setEndDate] = useState(TODAY);
  const [isPartDay, setIsPartDay] = useState(false);
  const [startTime, setStartTime] = useState("13:00");
  const [endTime, setEndTime] = useState("17:00");
  const [reason, setReason] = useState("");
  const dateError = endDate < startDate ? "The last day can’t be before the first." : undefined;
  const timeError = isPartDay && endTime <= startTime ? "End after it starts." : undefined;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (dateError || timeError) return;
    addTimeOff(staff.id, {
      start_date: startDate,
      end_date: endDate,
      start_time: isPartDay ? `${startTime}:00` : null,
      end_time: isPartDay ? `${endTime}:00` : null,
      reason: reason.trim() || null,
    });
    showToast({ tone: "success", message: `Time off added for ${staff.name}. It applies now.` });
    onClose();
  }

  return (
    <BottomSheet
      isOpen
      onClose={onClose}
      title="Add time off"
      description={`For ${staff.name}. It applies straight away, no approval needed.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="add-time-off-form">Add time off</Button>
        </>
      }
    >
      <form id="add-time-off-form" noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="grid gap-5 @md:grid-cols-2">
          <TextField label="First day" type="date" min={TODAY} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <TextField label="Last day" type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} error={dateError} />
        </div>
        <SwitchField label="Part of the day" description="Only some hours on each of these days" isOn={isPartDay} onChange={setIsPartDay} />
        {isPartDay && (
          <div className="grid gap-5 @md:grid-cols-2">
            <TextField label="From" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            <TextField label="To" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} error={timeError} />
          </div>
        )}
        <TextField
          label="Reason"
          help="Optional, in their own words."
          maxLength={REASON_MAX}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </form>
    </BottomSheet>
  );
}
