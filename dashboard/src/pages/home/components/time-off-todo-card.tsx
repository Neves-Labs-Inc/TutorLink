// To do › Time off (Admins only): pending requests, oldest request first.
// A row opens the request, where Approve and Decline live.
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarX2, ChevronRight, Plane } from "lucide-react";
import { Avatar, Badge } from "@/components/kit/components/badges";
import TodoCard from "@/components/kit/components/todo-card";
import { pluralize } from "@/components/kit/format";
import type { ExceptionRead } from "@/lib/queries/time-off";
import TodoRow from "@/pages/home/components/todo-row";
import type { HomeGroup, TodoList } from "@/pages/home/hooks/use-home-data";
import {
  formatTimeOffDates,
  formatTimeOffTimes,
  ROLE_LABEL,
  ROWS_PER_CARD,
} from "@/pages/home/lib/home-labels";

type TimeOffTodoCardProps = { group: HomeGroup<TodoList<ExceptionRead>> };

export default function TimeOffTodoCard({
  group,
}: TimeOffTodoCardProps): ReactNode {
  const navigate = useNavigate();
  return (
    <TodoCard
      id="time-off"
      title="Time off"
      icon={Plane}
      tone="yellow"
      phase={group.phase}
      total={group.data?.total ?? 0}
      emptyHint="No time-off requests to review."
      seeAllLabel="pending time-off requests"
      onSeeAll={() => navigate("/time-off")}
      onRetry={group.retry}
      isRetrying={group.isRetrying}
    >
      {group.data?.items.slice(0, ROWS_PER_CARD).map((item) => (
        <TimeOffRow key={item.id} item={item} />
      ))}
    </TodoCard>
  );
}

type TimeOffRowProps = { item: ExceptionRead };

function TimeOffRow({ item }: TimeOffRowProps): ReactNode {
  const clashCount = item.clashing_bookings_count;
  const times = formatTimeOffTimes(item);
  // Tutors are the usual case; any other role is named.
  const role = item.staff.role === "tutor" ? null : ROLE_LABEL[item.staff.role];
  return (
    <TodoRow
      action={{ to: `/time-off/${item.id}` }}
      title={item.staff.name}
      titleAside={
        role && <span className="text-[13px] text-(--tl-muted)">{role}</span>
      }
      leading={<Avatar name={item.staff.name} />}
      trailing={<ReviewCue />}
    >
      <span className="block text-[14px] leading-5 text-(--tl-ink-soft) tabular-nums">
        {formatTimeOffDates(item)}
        {times && (
          // Kept whole: narrow 3-column cards broke it as "2:00 / PM".
          <span className="whitespace-nowrap"> · {times}</span>
        )}
      </span>
      {item.reason && (
        <span className="mt-0.5 line-clamp-1 text-[13px] leading-[18px] text-(--tl-muted)">
          {item.reason}
        </span>
      )}
      {clashCount > 0 && (
        <span className="mt-1.5 flex">
          <Badge tone="warning" icon={CalendarX2}>
            {pluralize(clashCount, "Booking", "Bookings")} in these dates
          </Badge>
        </span>
      )}
    </TodoRow>
  );
}

// "Review ›" where the card is wide enough, a chevron below that.
function ReviewCue(): ReactNode {
  return (
    <>
      <span className="mt-0.5 hidden shrink-0 items-center gap-0.5 text-[13px] font-semibold text-(--tl-link) @md:inline-flex">
        Review
        <ChevronRight
          aria-hidden
          className="size-4 transition-transform duration-150 group-hover:translate-x-0.5"
        />
      </span>
      <ChevronRight
        aria-hidden
        className="mt-0.5 size-5 shrink-0 text-(--tl-muted) transition-transform duration-150 group-hover:translate-x-0.5 @md:hidden"
      />
    </>
  );
}
