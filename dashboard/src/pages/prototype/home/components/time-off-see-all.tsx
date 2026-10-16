// Where Time off's "See all" lands for an Admin: Time off ▸ Pending, the
// same rows as the card, every request. Upcoming and Past belong to the
// Time off prototype. A Manager has no Time off card on Home, so their
// Time off (their own requests) is only pointed at.
import { useState } from "react";
import type { ReactNode } from "react";
import { Plane } from "lucide-react";
import { SubPageTabs } from "@/components/kit/components/tabs";
import { PageHeader } from "@/components/kit/shell/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/kit/states/states";
import { CARD, cn } from "@/components/kit/tokens";
import DeclineDialog from "@/pages/prototype/home/components/decline-dialog";
import PrototypeNote from "@/pages/prototype/home/components/prototype-note";
import TimeOffDetail from "@/pages/prototype/home/components/time-off-detail";
import TimeOffTodoRow from "@/pages/prototype/home/components/time-off-todo-row";
import type { HomeDataApi } from "@/pages/prototype/home/hooks/use-home-data";
import { useTodoActions } from "@/pages/prototype/home/hooks/use-todo-actions";
import type { OfficeRole } from "@/pages/prototype/home/lib/mock-api";
import type { ExceptionRead } from "@/pages/prototype/home/types/api";

type TimeOffSeeAllProps = {
  role: OfficeRole;
  api: HomeDataApi;
};

export default function TimeOffSeeAll({
  role,
  api,
}: TimeOffSeeAllProps): ReactNode {
  const actions = useTodoActions(api);
  const [openItem, setOpenItem] = useState<ExceptionRead | null>(null);
  const items = api.data?.timeOff?.items ?? [];

  if (role === "manager") {
    return (
      <>
        <PageHeader title="Time off" />
        <EmptyState
          icon={Plane}
          title="Your own time off"
          body="Managers don’t review time off, so Home has no Time off card and no See all. This page holds a Manager’s own requests and is designed in the Time off prototype."
        />
      </>
    );
  }

  let list: ReactNode = (
    <ul className={cn(CARD, "flex flex-col px-2 py-1 @2xl:px-3")}>
      {items.map((item) => (
        <TimeOffTodoRow
          key={item.id}
          item={item}
          onOpen={setOpenItem}
        />
      ))}
    </ul>
  );
  if (api.phase === "loading") {
    list = <ListSkeleton rows={4} label="Loading time off" />;
  } else if (api.phase === "error") {
    list = (
      <ErrorState
        title="Couldn’t load time off"
        body="Check your connection and try again."
        onRetry={api.retry}
      />
    );
  } else if (items.length === 0) {
    list = (
      <EmptyState
        icon={Plane}
        tone="yellow"
        title="Nothing to review"
        body="New requests from Tutors and Managers land here and in To do."
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Time off"
        tabs={
          <SubPageTabs
            label="Time off pages"
            items={[
              { id: "pending", label: "Pending", count: api.data?.timeOff?.total },
              { id: "upcoming", label: "Upcoming" },
              { id: "past", label: "Past" },
            ]}
            activeId="pending"
            onChange={() => undefined}
          />
        }
      >
        <PrototypeNote>
          The Time off page is its own prototype. This shows where Home’s
          “See all” lands: Pending, soonest first. Rows open the details,
          where Approve and Decline live.
        </PrototypeNote>
      </PageHeader>
      {list}
      <TimeOffDetail
        item={openItem}
        backLabel="Time off"
        actions={actions}
        onClose={() => setOpenItem(null)}
      />
      <DeclineDialog actions={actions} />
    </>
  );
}
