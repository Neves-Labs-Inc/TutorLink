// Time off for Tutors and Managers: their own requests, grouped so the
// status reads at a glance (the Tutor pain point in #183). Rows open
// the details, where Cancel lives; Request time off is the one action.
import { useState } from "react";
import type { ReactNode } from "react";
import { Plane, Plus } from "lucide-react";
import { CARD, cn, HEADING } from "@/pages/prototype/shell-kit/kit/tokens";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import { PageHeader } from "@/pages/prototype/shell-kit/kit/shell/page-header";
import {
  EmptyState,
  ErrorState,
  ListSkeleton,
} from "@/pages/prototype/shell-kit/kit/states/states";
import TimeOffDetail from "@/pages/prototype/tutor-timeoff/components/time-off-detail";
import TimeOffFormSheet from "@/pages/prototype/tutor-timeoff/components/time-off-form-sheet";
import TimeOffRow from "@/pages/prototype/tutor-timeoff/components/time-off-row";
import { compareByStart, hasEnded } from "@/pages/prototype/tutor-timeoff/lib/rules";
import type { AreaStore } from "@/pages/prototype/tutor-timeoff/hooks/use-area-store";
import type { Phase } from "@/pages/prototype/tutor-timeoff/hooks/use-load-phase";
import type { ExceptionRead } from "@/pages/prototype/tutor-timeoff/types/api";

type Section = { id: string; title: string; hint: string; items: ExceptionRead[] };

function getSections(items: ExceptionRead[]): Section[] {
  const pending = items.filter((item) => item.status === "pending").sort(compareByStart);
  const coming = items
    .filter((item) => item.status === "approved" && !hasEnded(item))
    .sort(compareByStart);
  const history = items
    .filter((item) => !pending.includes(item) && !coming.includes(item))
    .sort((a, b) => compareByStart(b, a));
  return [
    { id: "pending", title: "Waiting for an Admin", hint: "You can still be booked in these times until an Admin approves.", items: pending },
    { id: "coming", title: "Coming up", hint: "Approved. You can’t be booked in these times.", items: coming },
    { id: "history", title: "History", hint: "Over, declined, cancelled or expired.", items: history },
  ].filter((section) => section.items.length > 0);
}

type OwnTimeOffScreenProps = {
  store: AreaStore;
  phase: Phase;
  isRetrying: boolean;
  onRetry: () => void;
  initialOpenId: string | null;
  isFormInitiallyOpen: boolean;
};

export default function OwnTimeOffScreen({
  store,
  phase,
  isRetrying,
  onRetry,
  initialOpenId,
  isFormInitiallyOpen,
}: OwnTimeOffScreenProps): ReactNode {
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [isFormOpen, setIsFormOpen] = useState(isFormInitiallyOpen);
  const own = store.timeOff.filter((item) => item.staff.id === store.me.id);
  const sections = getSections(own);
  const isManager = store.me.role === "manager";

  let content: ReactNode = (
    <div className="flex flex-col gap-8">
      {sections.map((section) => (
        <section key={section.id} aria-labelledby={`to-${section.id}`}>
          <div className="px-1 pb-3">
            <h2 id={`to-${section.id}`} className={HEADING}>
              {section.title}
            </h2>
            <p className="text-[14px] text-(--tl-muted)">{section.hint}</p>
          </div>
          <ul className={cn(CARD, "divide-y divide-(--tl-border) overflow-hidden")}>
            {section.items.map((item) => (
              <li key={item.id}>
                <TimeOffRow item={item} onOpen={() => setOpenId(item.id)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
  if (phase === "loading") {
    content = <ListSkeleton rows={3} label="Loading your time off" />;
  } else if (phase === "error") {
    content = (
      <ErrorState
        title="Couldn’t load your time off"
        body="Check your connection and try again."
        onRetry={onRetry}
        isRetrying={isRetrying}
      />
    );
  } else if (own.length === 0) {
    content = (
      <EmptyState
        icon={Plane}
        tone="yellow"
        title="No time off yet"
        body="Ask for days, or part of a day, when you can’t be booked. You’ll see here when an Admin approves it."
        action={
          <Button variant="primary" icon={Plus} onClick={() => setIsFormOpen(true)}>
            Request time off
          </Button>
        }
      />
    );
  }

  return (
    <>
      <PageHeader
        title={isManager ? "Your time off" : "Time off"}
        description="Times you can’t be booked. An Admin approves each request."
        primaryAction={
          phase === "ready"
            ? { label: "Request time off", icon: Plus, onClick: () => setIsFormOpen(true) }
            : undefined
        }
      />
      {content}
      <TimeOffDetail
        item={store.timeOff.find((item) => item.id === openId) ?? null}
        store={store}
        backLabel="Time off"
        onClose={() => setOpenId(null)}
      />
      <TimeOffFormSheet
        isOpen={isFormOpen}
        mode="request"
        me={store.me}
        staff={store.staff}
        onClose={() => setIsFormOpen(false)}
        onSubmit={store.createTimeOff}
        onCreated={(item) => {
          setIsFormOpen(false);
          setOpenId(item.id);
        }}
      />
    </>
  );
}
