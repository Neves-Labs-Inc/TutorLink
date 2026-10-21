// Time off (`/time-off`, `/time-off/:id`; replaces the Tutor-only Time
// off): Admins and Developers get everyone's Time off as a queue,
// Tutors and Managers their own requests. `:id` opens one Time off's
// details over the list, which keeps its URL state behind them.
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import OwnTimeOff from "@/pages/time-off/components/own-time-off";
import TimeOffDetails from "@/pages/time-off/components/time-off-details";
import TimeOffQueue from "@/pages/time-off/components/time-off-queue";
import { TIME_OFF_PATH } from "@/pages/time-off/hooks/use-time-off-queue";
import { isAdminViewer } from "@/pages/time-off/lib/time-off-rules";
import { useAuthStore } from "@/stores/authStore";

// Set on details opened from the page, so closing steps Back to the list
// instead of stacking a second list entry that Back would reopen from.
type DetailsState = { isFromList?: boolean } | null;

export default function TimeOffPage(): ReactNode {
  const navigate = useNavigate();
  const { id = null } = useParams();
  const location = useLocation();
  // Router state is whatever the last navigation set; ours is DetailsState.
  const locationState = location.state as DetailsState;
  const role = useAuthStore((state) => state.role);
  const userId = useAuthStore((state) => state.userId);
  const pageRef = useRef<HTMLDivElement>(null);
  const isTitleFocusDue = useRef(false);

  // A deep link has no row to hand focus back to: the title takes it,
  // once the details have closed and the page is no longer inert. Runs
  // after the overlay's own cleanup has tried its opener.
  useEffect(() => {
    if (!isTitleFocusDue.current || id !== null) return;
    isTitleFocusDue.current = false;
    const title = pageRef.current?.querySelector("h1");
    title?.setAttribute("tabindex", "-1");
    title?.focus();
  }, [id]);

  // The route guard has already settled a signed-in role.
  if (role === null || userId === null) return null;

  const viewer = { id: userId, role };

  function handleOpen(itemId: string, search: string = location.search): void {
    if (search !== location.search) {
      navigate({ pathname: TIME_OFF_PATH, search }, { replace: true });
    }
    navigate(
      { pathname: `${TIME_OFF_PATH}/${itemId}`, search },
      { state: { isFromList: true } },
    );
  }

  function handleClose(): void {
    if (locationState?.isFromList) {
      navigate(-1);
    } else {
      navigate({ pathname: TIME_OFF_PATH, search: location.search }, { replace: true });
      isTitleFocusDue.current = true;
    }
  }

  return (
    <div ref={pageRef}>
      {isAdminViewer(viewer) ? (
        <TimeOffQueue viewer={viewer} onOpen={handleOpen} />
      ) : (
        <OwnTimeOff viewer={viewer} onOpen={(itemId) => handleOpen(itemId)} />
      )}
      <TimeOffDetails
        id={id}
        viewer={viewer}
        backLabel="Time off"
        onClose={handleClose}
      />
    </div>
  );
}
