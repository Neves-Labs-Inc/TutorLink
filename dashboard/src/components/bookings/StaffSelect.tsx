import type { ReactNode } from "react";

import { Select } from "@/components/ui/select";
import { STAFF_ROLE_ORDER } from "@/lib/booking-form/bookingForm";
import type { Staff, StaffRole } from "@/lib/queries/staff";

type StaffSelectProps = {
  id: string;
  // The chosen Staff member's user id, or "".
  value: string;
  // Already narrowed to the roles the kind allows (`staffOptionsFor`).
  options: Staff[];
  disabled: boolean;
  invalid: boolean;
  onChange: (staff: Staff | null) => void;
};

const GROUP_LABELS: Record<StaffRole, string> = {
  tutor: "Tutors",
  manager: "Managers",
  admin: "Admins",
};

// Staff grouped by role with native `<optgroup>`s; a group with nobody in it is left out.
export default function StaffSelect({
  id,
  value,
  options,
  disabled,
  invalid,
  onChange,
}: StaffSelectProps): ReactNode {
  const groups = STAFF_ROLE_ORDER.map((role) => ({
    role,
    members: options.filter((member) => member.role === role),
  })).filter((group) => group.members.length > 0);

  return (
    <Select
      id={id}
      value={value}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      onChange={(event) =>
        onChange(
          options.find((member) => member.id === event.target.value) ?? null,
        )
      }
    >
      <option value="">Select staff</option>
      {groups.map((group) => (
        <optgroup key={group.role} label={GROUP_LABELS[group.role]}>
          {group.members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}
