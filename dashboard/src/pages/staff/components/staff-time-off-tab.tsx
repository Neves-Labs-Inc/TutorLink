// Staff details ▸ Time off: Upcoming then History, paged. A row opens the
// Time off details stacked over Staff details. An Admin adds time off for
// this person, and it opens straight into its details.
import { useState } from "react";
import type { ReactNode } from "react";
import { Plane, Plus } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import { Pager } from "@/components/kit/components/pager";
import { EmptyState, InlineError, ListSkeleton } from "@/components/kit/states/states";
import { CARD, cn, EYEBROW } from "@/components/kit/tokens";
import type { ExceptionRead } from "@/lib/queries/time-off";
import type { StaffRead } from "@/lib/queries/staff";
import TimeOffDetails from "@/pages/time-off/components/time-off-details";
import TimeOffFormSheet from "@/pages/time-off/components/time-off-form-sheet";
import TimeOffRow from "@/pages/time-off/components/time-off-row";
import { getFirstName } from "@/pages/time-off/lib/time-off-copy";
import type { Viewer } from "@/pages/time-off/lib/time-off-rules";
import {
  TIME_OFF_PAGE_SIZE,
  useStaffTimeOff,
} from "@/pages/staff/hooks/use-staff-time-off";

type TimeOffSectionProps = {
  title: string;
  items: ExceptionRead[];
  onOpen: (id: string) => void;
};

function TimeOffSection({ title, items, onOpen }: TimeOffSectionProps): ReactNode {
  if (items.length === 0) return null;
  return (
    <section>
      <h3 className={cn(EYEBROW, "mb-3")}>{title}</h3>
      <ul className={cn(CARD, "divide-y divide-(--tl-border) overflow-hidden")}>
        {items.map((item) => (
          <TimeOffRow key={item.id} item={item} variant="compact" onOpen={onOpen} />
        ))}
      </ul>
    </section>
  );
}

type StaffTimeOffTabProps = {
  staff: StaffRead;
  viewer: Viewer;
  canAdd: boolean;
};

export default function StaffTimeOffTab({
  staff,
  viewer,
  canAdd,
}: StaffTimeOffTabProps): ReactNode {
  const timeOff = useStaffTimeOff(staff.id);
  const [openId, setOpenId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const { sections } = timeOff;
  const isEmpty = sections?.upcoming.length === 0 && sections.history.length === 0;

  let body: ReactNode = <ListSkeleton rows={3} label="Loading time off" />;
  if (timeOff.hasFailed) {
    body = (
      <InlineError
        message="Couldn’t load their time off. Check your connection and try again."
        onRetry={timeOff.retry}
        isRetrying={timeOff.isRetrying}
      />
    );
  } else if (isEmpty) {
    body = <EmptyState isBare icon={Plane} tone="yellow" title="No time off" />;
  } else if (sections) {
    body = (
      <>
        <TimeOffSection title="Upcoming" items={sections.upcoming} onOpen={setOpenId} />
        <TimeOffSection title="History" items={sections.history} onOpen={setOpenId} />
        {timeOff.total > TIME_OFF_PAGE_SIZE && (
          <Pager
            page={timeOff.page}
            pageSize={TIME_OFF_PAGE_SIZE}
            total={timeOff.total}
            label="Time off pages"
            isDisabled={timeOff.isPageLoading}
            onPageChange={timeOff.setPage}
          />
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {canAdd && (
        <Button
          variant="soft"
          icon={Plus}
          className="self-start"
          onClick={() => setIsAdding(true)}
        >
          Add time off
        </Button>
      )}
      {body}
      <TimeOffFormSheet
        isOpen={isAdding}
        mode="add"
        viewer={viewer}
        person={{ id: staff.id, name: staff.name }}
        onClose={() => setIsAdding(false)}
        onCreated={(item) => {
          setIsAdding(false);
          setOpenId(item.id);
        }}
      />
      <TimeOffDetails
        id={openId}
        viewer={viewer}
        backLabel={`${getFirstName(staff.name)}’s details`}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}
