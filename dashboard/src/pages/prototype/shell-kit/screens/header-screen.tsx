// screen=header: the full page header anatomy inside the shell, on
// Staff. Toggle device=phone to see it collapse: the primary action
// becomes an icon button and the filter dropdowns scroll sideways.
// Sub-page tabs show on Chats and Time off (Admin).
import { useState } from "react";
import type { ReactNode } from "react";
import { Download, UserPlus } from "lucide-react";
import { STAFF } from "@/pages/prototype/shell-kit/kit/mock-data";
import type { Role } from "@/pages/prototype/shell-kit/kit/mock-data";
import { CARD, cn, EYEBROW } from "@/pages/prototype/shell-kit/kit/tokens";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import { AppShell } from "@/pages/prototype/shell-kit/kit/shell/app-shell";
import { PageHeader } from "@/pages/prototype/shell-kit/kit/shell/page-header";
import { PageToolbar } from "@/pages/prototype/shell-kit/kit/shell/page-toolbar";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";
import { StaffTable } from "@/pages/prototype/shell-kit/screens/people-tables";
import FilterDropdowns from "@/pages/prototype/shell-kit/screens/filter-dropdowns";
import {
  STAFF_FILTER_FIELDS,
  useStaffFilters,
} from "@/pages/prototype/shell-kit/screens/use-record-filters";

const ANATOMY = [
  ["Title", "Lato 300, 34px on phones, 44px from 1024px. Names the nav item."],
  ["Description", "One plain line of context, 15px muted."],
  ["Primary action", "One per page. A pill with a label from 672px; a 44px round icon button below, still named for screen readers."],
  ["Secondary actions", "Outline buttons, from 768px only. On phones they move into the record or an overflow."],
  ["Sub-page tabs", "Underlined nav between sub-pages, with counts (Chats ▸ Conversations / Reminders, Time off ▸ Pending / Upcoming / Past). Scrolls sideways on phones."],
  ["Toolbar", "Search, one filter dropdown per field (“Role · 1”), Clear all, view switch. On phones the search takes a row and the dropdowns scroll sideways; each opens as a bottom sheet."],
];

type HeaderScreenProps = { role: Role };

export default function HeaderScreen({ role }: HeaderScreenProps): ReactNode {
  const [query, setQuery] = useState("");
  const filters = useStaffFilters({ role: ["Tutor"] });
  const { showToast } = useToast();
  const rows = filters
    .apply(STAFF)
    .filter((staff) =>
      staff.name.toLowerCase().includes(query.trim().toLowerCase()),
    );

  return (
    <AppShell
      role={role === "tutor" ? "admin" : role}
      activeId="staff"
      onNavigate={() => undefined}
    >
      <PageHeader
        title="Staff"
        description="Everyone a Booking can be with: Tutors, Managers and Admins."
        primaryAction={{
          label: "Add staff",
          icon: UserPlus,
          onClick: () => showToast({ tone: "info", message: "Add staff opens a form." }),
        }}
        secondaryActions={<Button icon={Download}>Export</Button>}
      >
        <PageToolbar
          searchLabel="Search Staff"
          searchPlaceholder="Search by name"
          query={query}
          onQueryChange={setQuery}
          activeFilterCount={filters.activeCount}
          onClearFilters={filters.clearAll}
          filters={
            <FilterDropdowns
              fields={STAFF_FILTER_FIELDS}
              selected={filters.selected}
              onChange={filters.set}
            />
          }
        />
      </PageHeader>
      <StaffTable rows={rows} onOpen={() => undefined} />
      <section className={cn(CARD, "mt-8 p-5 @2xl:p-6")} aria-label="Header anatomy">
        <h2 className={EYEBROW}>Anatomy</h2>
        <dl className="mt-3 grid gap-x-8 gap-y-3 @3xl:grid-cols-2">
          {ANATOMY.map(([term, detail]) => (
            <div key={term}>
              <dt className="text-[14px] font-semibold">{term}</dt>
              <dd className="text-[14px] leading-5 text-(--tl-muted)">{detail}</dd>
            </div>
          ))}
        </dl>
      </section>
    </AppShell>
  );
}
