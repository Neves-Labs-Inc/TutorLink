// A Time off's status on the wire, as a badge. Expired (a pending
// request whose window has ended) isn't a kit status, so it's neutral.
import type { ReactNode } from "react";
import { Badge, TimeOffBadge } from "@/components/kit/components/badges";
import { getTimeOffLabel } from "@/pages/prototype/accounts-staff/lib/labels";
import type { ExceptionRead } from "@/pages/prototype/accounts-staff/types/api";

type TimeOffStatusBadgeProps = { item: ExceptionRead };

export default function TimeOffStatusBadge({ item }: TimeOffStatusBadgeProps): ReactNode {
  const label = getTimeOffLabel(item.status);
  return label === "Expired" ? <Badge tone="neutral">Expired</Badge> : <TimeOffBadge status={label} />;
}
