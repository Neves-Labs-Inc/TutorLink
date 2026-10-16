// A time grid with a left hour axis and one column per day (week) or per
// Staff member (day). Bookings are blocks placed by time; overlapping
// ones share the column side by side. Each empty hour is a button that
// starts a New booking there. Columns can shade "free" bands
// (availability) and carry all-day notes (Time off) under the header.
import type { ReactNode } from "react";
import { Plane } from "lucide-react";
import { CARD, cn } from "@/components/kit/tokens";
import {
  formatTime,
  fromMinutes,
  getFirstName,
  toMinutes,
} from "@/pages/prototype/bookings/lib/format";
import { REASON_ICON } from "@/pages/prototype/bookings/lib/reason-icons";
import type { BookingSummary } from "@/pages/prototype/bookings/lib/wire";

const FIRST_HOUR = 8;
const LAST_HOUR = 20;
const HOUR_PX = 64;
const MINUTES_PER_HOUR = 60;
const HOURS = Array.from(
  { length: LAST_HOUR - FIRST_HOUR },
  (_, index) => FIRST_HOUR + index,
);

export type GridColumn = {
  id: string;
  header: ReactNode;
  isToday?: boolean;
  bookings: BookingSummary[];
  // "HH:MM:SS" ranges shaded as free time.
  freeBands?: { start: string; end: string }[];
  notes?: string[];
  createLabel: (time: string) => string;
  onCreateAt: (time: string) => void;
};

type TimeGridProps = {
  columns: GridColumn[];
  nowTime?: string;
  showsStaff: boolean;
  onOpen: (booking: BookingSummary) => void;
  minColumnPx?: number;
};

function toTop(time: string): number {
  return ((toMinutes(time) - FIRST_HOUR * MINUTES_PER_HOUR) / MINUTES_PER_HOUR) * HOUR_PX;
}

function toHeight(start: string, end: string): number {
  return ((toMinutes(end) - toMinutes(start)) / MINUTES_PER_HOUR) * HOUR_PX;
}

type Placed = { booking: BookingSummary; lane: number; lanes: number };

// Greedy lanes within each cluster of overlapping blocks: a block takes
// the first lane free at its start, and only its cluster shares width.
function placeBookings(bookings: BookingSummary[]): Placed[] {
  const sorted = [...bookings].sort((a, b) => a.start_time.localeCompare(b.start_time));
  const clusters: BookingSummary[][] = [];
  let clusterEnd = "";
  for (const booking of sorted) {
    if (clusters.length === 0 || booking.start_time >= clusterEnd) {
      clusters.push([booking]);
      clusterEnd = booking.end_time;
    } else {
      clusters[clusters.length - 1].push(booking);
      if (booking.end_time > clusterEnd) clusterEnd = booking.end_time;
    }
  }
  return clusters.flatMap((cluster) => {
    const laneEnds: string[] = [];
    const placed = cluster.map((booking) => {
      let lane = laneEnds.findIndex((end) => end <= booking.start_time);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = booking.end_time;
      return { booking, lane };
    });
    return placed.map((item) => ({ ...item, lanes: laneEnds.length }));
  });
}

// 15 → "3 PM": the axis is narrow.
function formatHour(hour: number): string {
  const NOON = 12;
  const suffix = hour < NOON ? "AM" : "PM";
  return `${hour % NOON === 0 ? NOON : hour % NOON} ${suffix}`;
}

type BlockProps = {
  item: Placed;
  showsStaff: boolean;
  onOpen: (booking: BookingSummary) => void;
};

function Block({ item, showsStaff, onOpen }: BlockProps): ReactNode {
  const { booking, lane, lanes } = item;
  const isEvaluation = booking.kind === "evaluation";
  const isCancelled = booking.status === "cancelled";
  const [reason] = booking.sort_out_reasons;
  const ReasonIcon = reason ? REASON_ICON[reason] : null;
  const height = toHeight(booking.start_time, booking.end_time);
  const label = `${booking.child.name}, ${formatTime(booking.start_time)}, ${booking.staff.name}${reason ? ", needs sorting out" : ""}`;
  return (
    <button
      type="button"
      onClick={() => onOpen(booking)}
      aria-label={label}
      style={{
        top: toTop(booking.start_time) + 1,
        height: height - 2,
        left: `calc(${(lane / lanes) * 100}% + 2px)`,
        width: `calc(${100 / lanes}% - 4px)`,
      }}
      className={cn(
        "absolute z-10 flex cursor-pointer flex-col overflow-hidden rounded-[12px] border px-2 py-1 text-left text-[12px] leading-4 transition-shadow duration-150 hover:z-20 hover:shadow-md",
        isEvaluation
          ? "border-(--tl-pink-ink)/25 bg-(--tl-pink-tint) text-(--tl-pink-ink)"
          : "border-(--tl-primary)/20 bg-(--tl-tint-strong) text-(--tl-primary-ink)",
        reason && "border-2 border-(--tl-warning) bg-(--tl-warning-tint) text-(--tl-warning)",
        isCancelled && "border-dashed opacity-60",
      )}
    >
      <span className="flex items-center gap-1 font-semibold">
        {ReasonIcon && <ReasonIcon aria-hidden className="size-3.5 shrink-0" />}
        <span className={cn("truncate", isCancelled && "line-through")}>
          {booking.child.name}
        </span>
      </span>
      <span className="truncate tabular-nums">
        {formatTime(booking.start_time)}
        {isEvaluation ? " · Evaluation" : ` · ${booking.subject?.name ?? ""}`}
      </span>
      {showsStaff && height > HOUR_PX * 0.9 && (
        <span className="truncate opacity-80">{getFirstName(booking.staff.name)}</span>
      )}
    </button>
  );
}

export default function TimeGrid({
  columns,
  nowTime,
  showsStaff,
  onOpen,
  minColumnPx = 120,
}: TimeGridProps): ReactNode {
  const gridHeight = HOURS.length * HOUR_PX;
  const template = `56px repeat(${columns.length}, minmax(${minColumnPx}px, 1fr))`;
  const hasNotes = columns.some((column) => (column.notes ?? []).length > 0);

  return (
    <div className={cn(CARD, "overflow-x-auto")}>
      <div style={{ gridTemplateColumns: template }} className="grid min-w-fit">
        {/* Header row */}
        <div className="sticky left-0 z-30 border-b border-(--tl-border) bg-(--tl-surface)" />
        {columns.map((column) => (
          <div
            key={column.id}
            className={cn(
              "border-b border-l border-(--tl-border) px-2 py-3 text-center",
              column.isToday && "bg-(--tl-tint)",
            )}
          >
            {column.header}
          </div>
        ))}

        {/* All-day notes (Time off) */}
        {hasNotes && (
          <>
            <div className="sticky left-0 z-30 flex items-center justify-end border-b border-(--tl-border) bg-(--tl-surface) pr-2 text-[11px] font-semibold text-(--tl-muted) uppercase">
              Off
            </div>
            {columns.map((column) => (
              <div
                key={column.id}
                className="flex min-h-9 flex-col gap-1 border-b border-l border-(--tl-border) p-1"
              >
                {(column.notes ?? []).map((note) => (
                  <span
                    key={note}
                    className="flex items-center gap-1 truncate rounded-full bg-(--tl-yellow-tint) px-2 py-1 text-[12px] font-semibold text-(--tl-yellow-ink)"
                  >
                    <Plane aria-hidden className="size-3 shrink-0" />
                    <span className="truncate">{note}</span>
                  </span>
                ))}
              </div>
            ))}
          </>
        )}

        {/* Hour axis */}
        <div
          className="sticky left-0 z-30 bg-(--tl-surface)"
          style={{ height: gridHeight }}
        >
          {HOURS.map((hour) => (
            <div
              key={hour}
              style={{ height: HOUR_PX }}
              className="-translate-y-2 pr-2 text-right text-[12px] whitespace-nowrap text-(--tl-muted) tabular-nums"
            >
              {hour === FIRST_HOUR ? "" : formatHour(hour)}
            </div>
          ))}
        </div>

        {/* Columns */}
        {columns.map((column) => (
          <div
            key={column.id}
            className={cn(
              "relative border-l border-(--tl-border)",
              column.isToday && "bg-(--tl-tint)/40",
            )}
            style={{ height: gridHeight }}
          >
            {(column.freeBands ?? []).map((band) => (
              <div
                key={band.start}
                aria-hidden
                style={{ top: toTop(band.start), height: toHeight(band.start, band.end) }}
                className="absolute inset-x-0 bg-(--tl-green-tint)"
              />
            ))}
            {HOURS.map((hour) => {
              const time = fromMinutes(hour * MINUTES_PER_HOUR);
              return (
                <button
                  key={hour}
                  type="button"
                  tabIndex={-1}
                  aria-label={column.createLabel(time)}
                  title={column.createLabel(time)}
                  onClick={() => column.onCreateAt(time)}
                  style={{ top: (hour - FIRST_HOUR) * HOUR_PX, height: HOUR_PX }}
                  className="absolute inset-x-0 cursor-cell border-t border-(--tl-border)/70 hover:bg-(--tl-tint)"
                />
              );
            })}
            {placeBookings(column.bookings).map((item) => (
              <Block key={item.booking.id} item={item} showsStaff={showsStaff} onOpen={onOpen} />
            ))}
            {column.isToday && nowTime && (
              <div
                aria-hidden
                style={{ top: toTop(nowTime) }}
                className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-(--tl-danger)"
              >
                <span className="absolute -top-1 -left-1 size-2.5 rounded-full bg-(--tl-danger)" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
