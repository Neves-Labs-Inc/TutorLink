// Staff details (`/staff/:id`): the kit's slide-over from 672px, a
// pushed page below. A pinned header (sign-in or Archived badge, and the
// Admin's Edit and ⋯ slot), identity, a view-only or lock notice, then
// the tabs. Each tab body is its own module.
import { useEffect, useRef, useState } from "react";
import type { FocusEvent, ReactNode } from "react";
import { ArrowLeft, Eye, Lock, SearchX } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  ArchivedBadge,
  Avatar,
  SignInBadge,
} from "@/components/kit/components/badges";
import { Button } from "@/components/kit/components/button";
import { SubPageTabs } from "@/components/kit/components/tabs";
import { DetailOverlay } from "@/components/kit/overlays/detail-overlay";
import {
  EmptyState,
  InlineError,
  Skeleton,
} from "@/components/kit/states/states";
import type { Role } from "@/lib/auth/auth";
import type { StaffRead } from "@/lib/queries/staff";
import { roleLabel } from "@/lib/users/users";
import StaffDetailsSkeleton from "@/pages/staff/components/staff-details-skeleton";
import StaffOverviewTab from "@/pages/staff/components/staff-overview-tab";
import { useStaffDetails } from "@/pages/staff/hooks/use-staff-details";
import { getSignInLabel } from "@/pages/staff/lib/staff-labels";
import type { StaffTab } from "@/pages/staff/lib/staff-labels";
import { getStaffPermissions } from "@/pages/staff/lib/staff-permissions";
import type { StaffPermissions } from "@/pages/staff/lib/staff-permissions";

const MANAGER_NOTICE_WITH_CHILDREN =
  "View only, apart from their assigned Children. An Admin changes Staff, their teaching and their Time off.";
const MANAGER_NOTICE = "View only. An Admin changes Staff.";

type Notice = { icon: LucideIcon; text: string };

function getNotice(viewerRole: Role, can: StaffPermissions): Notice | null {
  let notice: Notice | null = null;
  if (viewerRole === "manager") {
    notice = {
      icon: Eye,
      text: can.canEditChildren ? MANAGER_NOTICE_WITH_CHILDREN : MANAGER_NOTICE,
    };
  } else if (can.lockReason) {
    notice = { icon: Lock, text: can.lockReason };
  }
  return notice;
}

type StaffDetailsHeaderProps = {
  staff: StaffRead;
  // The Admin's Edit and ⋯ menu (account acts), right of the badge.
  actions?: ReactNode;
};

function StaffDetailsHeader({
  staff,
  actions,
}: StaffDetailsHeaderProps): ReactNode {
  return (
    <div className="flex items-center justify-between gap-2">
      {staff.archived ? (
        <ArchivedBadge />
      ) : (
        <SignInBadge state={getSignInLabel(staff.sign_in_state)} />
      )}
      {actions && <span className="flex items-center gap-1">{actions}</span>}
    </div>
  );
}

// Availability, Children, Time off and Bookings land in their own
// tickets (11, 09); until then each tab has an empty body.
function getTabBodies(staff: StaffRead): Record<StaffTab, ReactNode> {
  return {
    overview: <StaffOverviewTab staff={staff} />,
    availability: null,
    children: null,
    "time-off": null,
    bookings: null,
  };
}

type StaffDetailsProps = {
  // Undefined while closed (and through the close animation).
  staffId: string | undefined;
  backLabel: string;
  viewerRole: Role;
  viewerId: string;
  onClose: () => void;
};

export default function StaffDetails({
  staffId,
  backLabel,
  viewerRole,
  viewerId,
  onClose,
}: StaffDetailsProps): ReactNode {
  const details = useStaffDetails(staffId);
  const { staff } = details;
  const tabsRef = useRef<HTMLDivElement>(null);
  const staffShownId = staff?.id;

  // A deep-linked tab may sit past the panel's edge; bring it into view.
  useEffect(() => {
    tabsRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [details.tab, staffShownId]);

  // Tabs past the right edge get a fade, so the row reads as scrollable.
  const [hasTabsPastEdge, setHasTabsPastEdge] = useState(false);
  useEffect(() => {
    const nav = tabsRef.current?.querySelector("nav");
    if (!nav) return;
    function measure(): void {
      if (!nav) return;
      // 1px of slack for fractional widths.
      setHasTabsPastEdge(nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    nav.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      nav.removeEventListener("scroll", measure);
    };
  }, [staffShownId]);

  // A tab reached with Tab may sit past the edge; bring it in too.
  function handleTabFocus(event: FocusEvent<HTMLDivElement>): void {
    event.target.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  let header: ReactNode = null;
  let body: ReactNode = null;
  if (details.isLoading) {
    header = <Skeleton className="h-7 w-24 rounded-full" />;
    body = <StaffDetailsSkeleton />;
  } else if (details.isNotFound) {
    body = (
      <EmptyState
        isBare
        icon={SearchX}
        title="Couldn’t find this Staff member"
        body="They may have been removed."
        action={
          <Button icon={ArrowLeft} onClick={onClose}>
            Back to Staff
          </Button>
        }
      />
    );
  } else if (details.hasFailed) {
    body = (
      <InlineError
        message="Couldn’t load their details. Check your connection and try again."
        onRetry={details.retry}
        isRetrying={details.isRetrying}
      />
    );
  } else if (staff) {
    const can = getStaffPermissions(viewerRole, viewerId, staff);
    const notice = getNotice(viewerRole, can);
    header = <StaffDetailsHeader staff={staff} />;
    body = (
      <>
        <div className="flex items-center gap-4">
          <Avatar name={staff.name} size="lg" />
          <div className="min-w-0">
            <h2 className="kit-display truncate text-[28px] leading-9 font-light">
              {staff.name}
            </h2>
            <p className="text-[14px] text-(--tl-muted)">
              {roleLabel(staff.role)}
            </p>
          </div>
        </div>
        {notice && (
          <p className="mt-4 flex items-start gap-2 rounded-[16px] bg-(--tl-surface-sunk) px-4 py-3 text-[13px] leading-5 text-(--tl-ink-soft)">
            <notice.icon aria-hidden className="mt-0.5 size-4 shrink-0" />
            {notice.text}
          </p>
        )}
        {/* The nav itself bleeds to the panel's edges and scrolls there:
            the kit drops its own bleed at @2xl, which the 440px slide-over
            still needs. Scroll padding keeps a scrolled-in tab clear of
            the edge (and of the fade). */}
        <div
          ref={tabsRef}
          onFocus={handleTabFocus}
          data-has-more={hasTabsPastEdge}
          className="mt-5 -mx-5 @2xl:-mx-6 [&>nav]:mx-0 [&>nav]:px-5 [&>nav]:scroll-px-5 @2xl:[&>nav]:px-6 @2xl:[&>nav]:scroll-px-6 data-[has-more=true]:[&>nav]:[mask-image:linear-gradient(to_right,black_calc(100%-32px),transparent)]"
        >
          <SubPageTabs
            label="Staff details sections"
            activeId={details.tab}
            // Ids come from `details.tabs`.
            onChange={(id) => details.changeTab(id as StaffTab)}
            items={details.tabs}
          />
        </div>
        <div className="pt-5">{getTabBodies(staff)[details.tab]}</div>
      </>
    );
  }

  return (
    <DetailOverlay
      isOpen={staffId !== undefined}
      onClose={onClose}
      title={staff ? `Staff: ${staff.name}` : "Staff details"}
      backLabel={backLabel}
      phoneMode="page"
      isHeaderPinned
      header={header}
    >
      {body}
    </DetailOverlay>
  );
}
