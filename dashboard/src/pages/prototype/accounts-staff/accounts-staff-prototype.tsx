// Plan: Accounts (Children / Guardians, Homes on the Guardian) and Staff
// (TutorLink#195) on the approved shell kit, in Faithful pastel.
// Throwaway, DEV-only, mock data in the API's wire shapes (PR #224).
// Route /prototype/accounts-staff, driven by the floating switcher:
//   ?screen=families|family|child|guardian|add-account
//          |staff|staff-archived|staff-detail|add-staff|staff-setup
//   ?role=admin|manager
//   ?state=populated|loading|empty|error
//   ?device=desktop|phone        phone frames the page at 390×844
//   ?theme=light|dark
// Every screen is a starting point; the page stays live from there
// (open rows, filter, edit, archive, add Homes, add Staff...).
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { PrototypeSwitcher } from "@/components/shared/PrototypeSwitcher";
import type { SwitcherOption } from "@/components/shared/PrototypeSwitcher";
import { DeviceFrame } from "@/pages/prototype/shell-kit/kit/device-frame";
import type { Theme } from "@/pages/prototype/shell-kit/kit/tokens";
import AreaApp from "@/pages/prototype/accounts-staff/components/area-app";
import type {
  DataState,
  OfficeRole,
  Screen,
} from "@/pages/prototype/accounts-staff/types/screens";

const SCREENS: (SwitcherOption & { id: Screen })[] = [
  { id: "families", label: "Families" },
  { id: "family", label: "Family overview" },
  { id: "child", label: "Family › Child details" },
  { id: "guardian", label: "Family › Guardian + Homes" },
  { id: "add-account", label: "Add child (new family)" },
  { id: "staff", label: "Staff" },
  { id: "staff-archived", label: "Staff · Archived" },
  { id: "staff-detail", label: "Staff details" },
  { id: "add-staff", label: "Add staff" },
  { id: "staff-setup", label: "New Staff · setup checklist" },
];

const ROLES: (SwitcherOption & { id: OfficeRole })[] = [
  { id: "admin", label: "Admin" },
  { id: "manager", label: "Manager" },
];

const STATES: (SwitcherOption & { id: DataState })[] = [
  { id: "populated", label: "Populated" },
  { id: "loading", label: "Loading" },
  { id: "empty", label: "Empty" },
  { id: "error", label: "Error" },
];

const DEVICES: SwitcherOption[] = [
  { id: "desktop", label: "Desktop" },
  { id: "phone", label: "Phone" },
];

function pick<T extends string>(options: { id: T }[], value: string | null): T {
  return options.find((option) => option.id === value)?.id ?? options[0].id;
}

export default function AccountsStaffPrototype(): ReactNode {
  const [params] = useSearchParams();
  const screen = pick(SCREENS, params.get("screen"));
  const role = pick(ROLES, params.get("role"));
  const dataState = pick(STATES, params.get("state"));
  const theme: Theme = params.get("theme") === "dark" ? "dark" : "light";
  const isPhone = params.get("device") === "phone";

  return (
    <>
      <DeviceFrame theme={theme} isPhone={isPhone}>
        {/* Remount on every switch so each screen starts from its own state. */}
        <AreaApp
          key={`${screen}-${role}-${dataState}`}
          screen={screen}
          role={role}
          dataState={dataState}
        />
      </DeviceFrame>
      <PrototypeSwitcher
        position="bottom"
        screens={SCREENS}
        toggles={[
          { param: "role", label: "Role", options: ROLES },
          { param: "state", label: "Data", options: STATES },
          { param: "device", label: "Device", options: DEVICES },
        ]}
      />
    </>
  );
}
