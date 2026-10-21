// Time off for Tutors and Managers: their own requests, grouped so the
// status reads at a glance. Rows open the details, where Cancel lives;
// Request time off is the one action.
import { useState } from "react";
import type { ReactNode } from "react";
import { Plane, Plus } from "lucide-react";
import { PageHeader } from "@/components/kit/shell/page-header";
import {
  EmptyState,
  ErrorState,
  ListSkeleton,
  Skeleton,
} from "@/components/kit/states/states";
import { CARD, cn, HEADING } from "@/components/kit/tokens";
import TimeOffFormSheet from "@/pages/time-off/components/time-off-form-sheet";
import TimeOffRow from "@/pages/time-off/components/time-off-row";
import { useOwnTimeOff } from "@/pages/time-off/hooks/use-own-time-off";
import type { OwnSection, Viewer } from "@/pages/time-off/lib/time-off-rules";

const SECTION_COPY: Record<OwnSection, { title: string; hint: string }> = {
  waiting: {
    title: "Waiting for an Admin",
    hint: "You can still be booked in these times until an Admin approves.",
  },
  coming: {
    title: "Coming up",
    hint: "Approved. You can’t be booked in these times.",
  },
  "declined-cancelled": {
    title: "Declined or cancelled",
    hint: "These won’t take effect. Request again if you still need the time.",
  },
  history: { title: "History", hint: "Over or expired." },
};

function OwnSkeleton(): ReactNode {
  return (
    <div>
      <div className="flex flex-col gap-2 px-1 pb-3">
        <Skeleton className="h-5 w-48 rounded-full" />
        <Skeleton className="h-3.5 w-72 max-w-full rounded-full" />
      </div>
      <ListSkeleton rows={3} label="Loading your time off" />
    </div>
  );
}

type OwnTimeOffProps = {
  viewer: Viewer;
  onOpen: (id: string) => void;
};

export default function OwnTimeOff({ viewer, onOpen }: OwnTimeOffProps): ReactNode {
  const own = useOwnTimeOff(viewer.id);
  const [isFormOpen, setIsFormOpen] = useState(false);

  let body: ReactNode;
  if (own.hasFailed) {
    body = (
      <ErrorState
        title="Couldn’t load your time off"
        body="Check your connection and try again."
        onRetry={own.retry}
        isRetrying={own.isRetrying}
      />
    );
  } else if (own.groups === undefined) {
    body = <OwnSkeleton />;
  } else if (own.groups.length === 0) {
    body = <EmptyState icon={Plane} tone="yellow" title="No time off yet" />;
  } else {
    body = (
      <div className="flex flex-col gap-8">
        {own.groups.map(({ section, items }) => (
          <section key={section} aria-labelledby={`time-off-${section}`}>
            <div className="px-1 pb-3">
              <h2 id={`time-off-${section}`} className={HEADING}>
                {SECTION_COPY[section].title}
              </h2>
              <p className="text-[14px] leading-5 text-(--tl-muted)">
                {SECTION_COPY[section].hint}
              </p>
            </div>
            <ul className={cn(CARD, "divide-y divide-(--tl-border) overflow-hidden")}>
              {items.map((item) => (
                <TimeOffRow key={item.id} item={item} variant="own" onOpen={onOpen} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    // Rows would stretch past a readable width on wide screens.
    <div className="max-w-[880px]">
      <PageHeader
        title={viewer.role === "manager" ? "Your time off" : "Time off"}
        description="Times you can’t be booked. An Admin approves each request."
        primaryAction={{
          label: "Request time off",
          icon: Plus,
          onClick: () => setIsFormOpen(true),
        }}
      />
      {body}
      <TimeOffFormSheet
        isOpen={isFormOpen}
        mode="request"
        viewer={viewer}
        onClose={() => setIsFormOpen(false)}
        onCreated={(item) => {
          setIsFormOpen(false);
          onOpen(item.id);
        }}
      />
    </div>
  );
}
