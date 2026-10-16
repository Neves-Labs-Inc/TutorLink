// Time off: upcoming first, then history. Rows open the Time off
// details, where an Admin approves, declines or cancels. Admins can add
// time off for anyone; it takes effect straight away.
import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronRight, Plane, Plus } from "lucide-react";
import { CARD, cn, EYEBROW } from "@/components/kit/tokens";
import { Button } from "@/components/kit/components/button";
import { EmptyState } from "@/components/kit/states/states";
import AddTimeOffSheet from "@/pages/prototype/accounts-staff/components/add-time-off-sheet";
import TimeOffSheet from "@/pages/prototype/accounts-staff/components/time-off-sheet";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import TimeOffStatusBadge from "@/pages/prototype/accounts-staff/components/time-off-status-badge";
import { formatTimeOffWindow } from "@/pages/prototype/accounts-staff/lib/labels";
import {
  isTimeOffUpcoming,
  listTimeOff,
} from "@/pages/prototype/accounts-staff/lib/mock-api";
import type { StaffPermissions } from "@/pages/prototype/accounts-staff/lib/staff-rules";
import type {
  ExceptionRead,
  StaffRead,
} from "@/pages/prototype/accounts-staff/types/api";

type ListProps = { title: string; items: ExceptionRead[]; onOpen: (id: string) => void };

function TimeOffList({ title, items, onOpen }: ListProps): ReactNode {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h3 className={EYEBROW}>{title}</h3>
      <ul className={cn(CARD, "divide-y divide-(--tl-border) overflow-hidden")}>
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onOpen(item.id)}
              className="flex min-h-[64px] w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-(--tl-tint) focus-visible:-outline-offset-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold">{formatTimeOffWindow(item)}</span>
                <span className="block truncate text-[13px] text-(--tl-muted)">{item.reason ?? "No reason given"}</span>
              </span>
              <TimeOffStatusBadge item={item} />
              <ChevronRight aria-hidden className="size-5 shrink-0 text-(--tl-muted)" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

type StaffTimeOffTabProps = { staff: StaffRead; can: StaffPermissions };

export default function StaffTimeOffTab({ staff, can }: StaffTimeOffTabProps): ReactNode {
  const { db } = useArea();
  const [openId, setOpenId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const items = listTimeOff(db, staff.id);
  // Upcoming soonest first; history most recent first.
  const upcoming = items.filter(isTimeOffUpcoming).reverse();
  const history = items.filter((item) => !isTimeOffUpcoming(item));
  const open = items.find((item) => item.id === openId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      {can.canAddTimeOff && (
        <div>
          <Button variant="soft" icon={Plus} onClick={() => setIsAdding(true)}>
            Add time off
          </Button>
        </div>
      )}
      {items.length === 0 ? (
        <EmptyState isBare icon={Plane} title="No Time off" body={`${staff.name} hasn’t asked for any Time off.`} />
      ) : (
        <>
          <TimeOffList title="Upcoming" items={upcoming} onOpen={setOpenId} />
          <TimeOffList title="History" items={history} onOpen={setOpenId} />
        </>
      )}
      {open && <TimeOffSheet item={open} canDecide={can.canDecideTimeOff} onClose={() => setOpenId(null)} />}
      {isAdding && <AddTimeOffSheet staff={staff} onClose={() => setIsAdding(false)} />}
    </div>
  );
}
