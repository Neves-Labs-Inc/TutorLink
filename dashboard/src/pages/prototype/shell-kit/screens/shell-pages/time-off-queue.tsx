// Time off for Admins: everyone's requests in three sub-pages. Pending
// has Approve / Decline right in the row (with Undo); Upcoming and Past
// are history. Home's To do links here with "See all".
import { useState } from "react";
import type { ReactNode } from "react";
import { Check, ChevronRight, Plane, X } from "lucide-react";
import { TIME_OFF } from "@/pages/prototype/shell-kit/kit/mock-data";
import type { TimeOff, TimeOffStatus } from "@/pages/prototype/shell-kit/kit/mock-data";
import { CARD, cn } from "@/pages/prototype/shell-kit/kit/tokens";
import { Avatar, TimeOffBadge } from "@/pages/prototype/shell-kit/kit/components/badges";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import { SubPageTabs } from "@/pages/prototype/shell-kit/kit/components/tabs";
import { PageHeader } from "@/pages/prototype/shell-kit/kit/shell/page-header";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";
import { EmptyState } from "@/pages/prototype/shell-kit/kit/states/states";
import TimeOffDetail from "@/pages/prototype/shell-kit/screens/time-off-detail";

type Tab = "pending" | "upcoming" | "past";

function getTab(item: TimeOff): Tab {
  let tab: Tab = item.timing === "past" ? "past" : "upcoming";
  if (item.status === "Pending") {
    tab = "pending";
  }
  return tab;
}

const EMPTY_COPY: Record<Tab, { title: string; body: string }> = {
  pending: {
    title: "Nothing to review",
    body: "New time-off requests from Tutors and Managers land here and in To do.",
  },
  upcoming: { title: "No time off coming up", body: "Approved time off shows here until it’s over." },
  past: { title: "No past time off", body: "Time off moves here once its dates have passed." },
};

export default function TimeOffQueue(): ReactNode {
  const [items, setItems] = useState<TimeOff[]>(TIME_OFF);
  const [tab, setTab] = useState<Tab>("pending");
  const [openId, setOpenId] = useState<string | null>(null);
  const { showToast } = useToast();
  const counts = {
    pending: items.filter((item) => getTab(item) === "pending").length,
    upcoming: items.filter((item) => getTab(item) === "upcoming").length,
    past: items.filter((item) => getTab(item) === "past").length,
  };
  const visible = items.filter((item) => getTab(item) === tab);

  function handleDecide(item: TimeOff, status: TimeOffStatus): void {
    const before = items;
    // A declined request is over for good, so it files under Past.
    setItems(
      items.map((current) =>
        current.id === item.id
          ? { ...current, status, timing: status === "Declined" ? "past" : current.timing }
          : current,
      ),
    );
    showToast({
      tone: "success",
      message: `${status} time off for ${item.staff}.`,
      actionLabel: "Undo",
      onAction: () => setItems(before),
    });
  }

  return (
    <>
      <PageHeader
        title="Time off"
        description="Only Admins approve or decline. An Admin’s own time off takes effect straight away."
        tabs={
          <SubPageTabs
            label="Time off sections"
            activeId={tab}
            // Ids come from the three items below.
            onChange={(id) => setTab(id as Tab)}
            items={[
              { id: "pending", label: "Pending", count: counts.pending },
              { id: "upcoming", label: "Upcoming", count: counts.upcoming },
              { id: "past", label: "Past", count: counts.past },
            ]}
          />
        }
      />
      {visible.length === 0 ? (
        <EmptyState icon={Plane} tone="yellow" {...EMPTY_COPY[tab]} />
      ) : (
        <ul className={cn(CARD, "divide-y divide-(--tl-border) overflow-hidden")}>
          {visible.map((item) => (
            <li
              key={item.id}
              className="flex min-h-[76px] flex-col gap-3 px-4 py-3.5 @2xl:flex-row @2xl:items-center @2xl:gap-4 @2xl:px-6"
            >
              {/* The row opens the request; Approve / Decline sit beside
                  it as their own buttons, never inside it. */}
              <button
                type="button"
                onClick={() => setOpenId(item.id)}
                className="group -mx-2 flex min-h-14 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-[14px] px-2 py-1.5 text-left transition-colors duration-150 hover:bg-(--tl-tint) active:bg-(--tl-tint-strong)"
              >
                <Avatar name={item.staff} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] leading-6 font-semibold">
                    {item.staff}
                    <span className="font-normal text-(--tl-muted)"> · {item.staffRole}</span>
                  </span>
                  <span className="block truncate text-[13px] leading-[18px] text-(--tl-muted)">
                    <span className="font-medium text-(--tl-ink-soft) tabular-nums">
                      {item.range}
                    </span>{" "}
                    · {item.reason}
                  </span>
                </span>
                {tab !== "pending" && <TimeOffBadge status={item.status} />}
                <ChevronRight aria-hidden className="size-5 shrink-0 text-(--tl-muted)" />
              </button>
              {tab === "pending" && (
                <div className="flex gap-2 pl-[52px] @2xl:pl-0">
                  <Button variant="soft" icon={Check} onClick={() => handleDecide(item, "Approved")}>
                    Approve
                  </Button>
                  <Button icon={X} onClick={() => handleDecide(item, "Declined")}>
                    Decline
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <TimeOffDetail
        item={items.find((item) => item.id === openId) ?? null}
        backLabel="Time off"
        onClose={() => setOpenId(null)}
        onDecide={handleDecide}
      />
    </>
  );
}
