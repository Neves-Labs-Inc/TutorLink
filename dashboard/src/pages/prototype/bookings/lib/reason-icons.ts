// One icon per sort-out reason, shared by badges, banner and calendar.
import { Archive, ClipboardCheck, Plane } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SortOutReason } from "@/pages/prototype/bookings/lib/wire";

export const REASON_ICON: Record<SortOutReason, LucideIcon> = {
  not_completed: ClipboardCheck,
  time_off_clash: Plane,
  archived_staff: Archive,
};
