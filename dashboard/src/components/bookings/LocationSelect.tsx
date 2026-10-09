import type { ReactNode } from "react";

import { Select } from "@/components/ui/select";
import { IN_OFFICE } from "@/lib/booking-form/bookingForm";
import type { ChildHome } from "@/lib/queries/children";

type LocationSelectProps = {
  id: string;
  // A home id, `IN_OFFICE`, or "".
  value: string;
  // Null until a Child is chosen; the select is then disabled with its own placeholder.
  childName: string | null;
  // The Child's active homes; empty while they load or when there are none.
  homes: ChildHome[];
  disabled: boolean;
  invalid: boolean;
  onChange: (location: string) => void;
};

function homeLabel(home: ChildHome): string {
  return home.label === null ? home.address : `${home.label} — ${home.address}`;
}

// The Child's homes, then the Office. The homes group is left out when there is none to
// offer, so "In office" is always a choice once a Child is picked.
export default function LocationSelect({
  id,
  value,
  childName,
  homes,
  disabled,
  invalid,
  onChange,
}: LocationSelectProps): ReactNode {
  const hasChild = childName !== null;

  return (
    <Select
      id={id}
      value={value}
      disabled={disabled || !hasChild}
      aria-invalid={invalid || undefined}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">
        {hasChild ? "Select a location" : "Choose a child first"}
      </option>
      {hasChild && homes.length > 0 && (
        <optgroup label={`${childName}'s homes`}>
          {homes.map((home) => (
            <option key={home.id} value={home.id}>
              {homeLabel(home)}
            </option>
          ))}
        </optgroup>
      )}
      {hasChild && (
        <optgroup label="Office">
          <option value={IN_OFFICE}>In office</option>
        </optgroup>
      )}
    </Select>
  );
}
