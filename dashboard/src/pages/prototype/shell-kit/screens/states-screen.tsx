// screen=states: empty, loading, error, offline and permission states,
// with a live list driven by the dashed prototype control.
import type { ReactNode } from "react";
import {
  CalendarPlus,
  CalendarSearch,
  Check,
  Plus,
} from "lucide-react";
import { BOOKINGS } from "@/pages/prototype/shell-kit/kit/mock-data";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import { SegmentedControl } from "@/pages/prototype/shell-kit/kit/components/tabs";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";
import {
  EmptyState,
  ErrorState,
  ListSkeleton,
  OfflineBanner,
  PermissionState,
  TableSkeleton,
} from "@/pages/prototype/shell-kit/kit/states/states";
import BookingRow from "@/pages/prototype/shell-kit/screens/booking-row";
import {
  Gallery,
  PrototypeControls,
  Specimen,
} from "@/pages/prototype/shell-kit/screens/gallery";
import {
  DATA_STATE_ITEMS,
  useSimulatedState,
} from "@/pages/prototype/shell-kit/screens/use-simulated-state";
import type { DataState } from "@/pages/prototype/shell-kit/screens/use-simulated-state";

const SAMPLE_ROWS = BOOKINGS.slice(3, 6);

export default function StatesScreen(): ReactNode {
  const simulated = useSimulatedState();
  const { showToast } = useToast();

  function renderLive(state: DataState): ReactNode {
    let content: ReactNode = (
      <div className="flex flex-col gap-3">
        {SAMPLE_ROWS.map((booking) => (
          <BookingRow key={booking.id} booking={booking} onOpen={() => undefined} />
        ))}
      </div>
    );
    if (state === "loading") {
      content = <ListSkeleton rows={3} label="Loading bookings" />;
    } else if (state === "error") {
      content = (
        <ErrorState
          title="Bookings didn’t load"
          body="Something went wrong on our side. Your data is safe; try again in a moment."
          onRetry={simulated.retry}
          isRetrying={simulated.isRetrying}
        />
      );
    } else if (state === "empty") {
      content = (
        <EmptyState
          icon={CalendarPlus}
          title="No bookings this week"
          body="When a Guardian books through the bot or the office adds one, it shows up here."
          action={
            <Button variant="primary" icon={Plus}>
              New booking
            </Button>
          }
        />
      );
    }
    return content;
  }

  return (
    <Gallery
      title="States"
      intro="Every list has four states. Loading mirrors the shape of what’s coming so nothing jumps. Errors say what happened and offer the fix; empty states say what will show up and how."
    >
      <Specimen title="Live list" isBare>
        <PrototypeControls label="Simulate">
          <SegmentedControl
            label="Data state"
            activeId={simulated.state}
            // Ids come from DATA_STATE_ITEMS, so each is a DataState.
            onChange={(id) => simulated.setState(id as DataState)}
            items={DATA_STATE_ITEMS}
          />
        </PrototypeControls>
        {renderLive(simulated.state)}
      </Specimen>
      <Specimen title="Empty" isBare>
        <div className="grid gap-4 @3xl:grid-cols-2">
          <EmptyState
            icon={Check}
            tone="green"
            title="All done"
            body="Nothing is waiting on the office. New chats and requests land here."
          />
          <EmptyState
            icon={CalendarSearch}
            title="No bookings match"
            body="Try another name, or clear the filters to see the whole week."
            action={<Button>Clear search and filters</Button>}
          />
        </div>
      </Specimen>
      <Specimen title="Loading: table" isBare>
        <TableSkeleton rows={3} label="Loading Staff" />
      </Specimen>
      <Specimen title="Offline" isBare note="Shown above the page; the last data stays visible.">
        <OfflineBanner
          onRetry={() => showToast({ tone: "success", message: "Back online." })}
        />
      </Specimen>
      <Specimen title="No access" isBare note="E.g. a Manager following a link to Settings.">
        <PermissionState
          title="Only Admins can open Settings"
          body="Ask an Admin if something here needs changing."
          action={<Button>Go to Home</Button>}
        />
      </Specimen>
    </Gallery>
  );
}
