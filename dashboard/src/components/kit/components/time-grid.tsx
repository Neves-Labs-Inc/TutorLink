// A time grid with a left hour axis and one column per day (week) or per
// Staff member (day). Bookings are blocks placed by time; overlapping
// ones share the column side by side. Each empty hour is a button that
// starts a New booking there. Columns can shade availability, carry
// Time off chips under the header, and show the "now" line. Stateless:
// the caller owns loading, error and empty, and passes every label.
import type { ReactNode } from "react";
import { Plane, Plus } from "lucide-react";
import { Badge } from "@/components/kit/components/badges";
import BookingBlock from "@/components/kit/components/booking-block";
import type { BookingBlockDisplay } from "@/components/kit/components/booking-block";
import { CARD, cn, EYEBROW } from "@/components/kit/tokens";

const DEFAULT_FIRST_HOUR = 8;
const DEFAULT_LAST_HOUR = 20;
const HOUR_PX = 64;
const MINUTES_PER_HOUR = 60;
const NOON = 12;
const AXIS_PX = 56;
const LANE_GUTTER_PX = 2;

export type GridBlock = BookingBlockDisplay & {
  id: string;
  // "HH:MM" or "HH:MM:SS".
  startTime: string;
  endTime: string;
};

export type GridTimeOff = { id: string; label: string; title: string };

export type GridColumn = {
  id: string;
  header: ReactNode;
  isToday?: boolean;
  // The "now" line crosses this column.
  hasNow?: boolean;
  blocks: GridBlock[];
  availability?: { start: string; end: string }[];
  timeOff?: GridTimeOff[];
  // Extra chips in the notes row (an ArchivedBadge for a Staff column).
  notes?: ReactNode;
  createLabel: (time: string) => string;
};

type TimeGridProps = {
  columns: GridColumn[];
  nowTime?: string;
  onOpen: (id: string) => void;
  onCreateAt: (columnId: string, time: string) => void;
  // Day by Staff passes 140: columns scroll inside the card. Without it,
  // columns share the width (the week fits 7 columns at 768px).
  minColumnPx?: number;
};

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * MINUTES_PER_HOUR + minutes;
}

function toWireTime(totalMinutes: number): string {
  const hours = String(Math.floor(totalMinutes / MINUTES_PER_HOUR)).padStart(2, "0");
  const minutes = String(totalMinutes % MINUTES_PER_HOUR).padStart(2, "0");
  return `${hours}:${minutes}:00`;
}

// 15 → "3 PM": the axis is narrow.
function formatHour(hour: number): string {
  const suffix = hour < NOON ? "AM" : "PM";
  return `${hour % NOON === 0 ? NOON : hour % NOON} ${suffix}`;
}

// The default 8 AM to 8 PM, widened so no Booking falls off the grid.
function getHourRange(columns: GridColumn[]): { first: number; last: number } {
  const spans = columns.flatMap((column) => [
    ...column.blocks.map((block) => ({ start: block.startTime, end: block.endTime })),
    ...(column.availability ?? []),
  ]);
  const starts = spans.map((span) => Math.floor(toMinutes(span.start) / MINUTES_PER_HOUR));
  const ends = spans.map((span) => Math.ceil(toMinutes(span.end) / MINUTES_PER_HOUR));
  return {
    first: Math.min(DEFAULT_FIRST_HOUR, ...starts),
    last: Math.max(DEFAULT_LAST_HOUR, ...ends),
  };
}

type Placed = { block: GridBlock; lane: number; lanes: number };

// Greedy lanes within each cluster of overlapping blocks: a block takes
// the first lane free at its start, and only its cluster shares width.
function placeBlocks(blocks: GridBlock[]): Placed[] {
  const sorted = [...blocks].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  const clusters: GridBlock[][] = [];
  let clusterEnd = 0;
  for (const block of sorted) {
    if (clusters.length === 0 || toMinutes(block.startTime) >= clusterEnd) {
      clusters.push([block]);
      clusterEnd = toMinutes(block.endTime);
    } else {
      clusters[clusters.length - 1].push(block);
      clusterEnd = Math.max(clusterEnd, toMinutes(block.endTime));
    }
  }
  return clusters.flatMap((cluster) => {
    const laneEnds: number[] = [];
    const placed = cluster.map((block) => {
      let lane = laneEnds.findIndex((end) => end <= toMinutes(block.startTime));
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = toMinutes(block.endTime);
      return { block, lane };
    });
    return placed.map((item) => ({ ...item, lanes: laneEnds.length }));
  });
}

export default function TimeGrid({
  columns,
  nowTime,
  onOpen,
  onCreateAt,
  minColumnPx = 0,
}: TimeGridProps): ReactNode {
  const { first, last } = getHourRange(columns);
  const hours = Array.from({ length: last - first }, (_, index) => first + index);
  const gridHeight = hours.length * HOUR_PX;
  const template = `${AXIS_PX}px repeat(${columns.length}, minmax(${minColumnPx}px, 1fr))`;
  const hasNotes = columns.some(
    (column) => (column.timeOff ?? []).length > 0 || column.notes,
  );
  const firstNowColumn = columns.find((column) => column.hasNow)?.id;

  // Outside the hour body the line would draw over the header or below it.
  function isNowInRange(time: string): boolean {
    const minutes = toMinutes(time);
    return minutes >= first * MINUTES_PER_HOUR && minutes <= last * MINUTES_PER_HOUR;
  }

  function toTop(time: string): number {
    return ((toMinutes(time) - first * MINUTES_PER_HOUR) / MINUTES_PER_HOUR) * HOUR_PX;
  }

  function toHeight(start: string, end: string): number {
    return ((toMinutes(end) - toMinutes(start)) / MINUTES_PER_HOUR) * HOUR_PX;
  }

  return (
    <div className={cn(CARD, "kit-no-scrollbar overflow-x-auto")}>
      <div
        style={{ gridTemplateColumns: template }}
        className={cn("grid", minColumnPx > 0 && "min-w-fit")}
      >
        <div className="sticky left-0 z-30 border-b border-(--tl-border) bg-(--tl-surface)" />
        {columns.map((column) => (
          <div
            key={column.id}
            className={cn(
              "min-w-0 border-b border-l border-(--tl-border) px-2 py-3 text-center",
              column.isToday && "bg-(--tl-tint)",
            )}
          >
            {column.header}
          </div>
        ))}

        {hasNotes && (
          <>
            <div className={cn(EYEBROW, "sticky left-0 z-30 flex items-center justify-end border-b border-(--tl-border) bg-(--tl-surface) pr-2")}>
              Off
            </div>
            {columns.map((column) => (
              <div
                key={column.id}
                className="flex min-h-9 min-w-0 flex-col gap-1 border-b border-l border-(--tl-border) p-1"
              >
                {(column.timeOff ?? []).map((off) => (
                  <span key={off.id} title={off.title} className="max-w-full min-w-0 self-start truncate">
                    <Badge tone="yellow" icon={Plane}>
                      {off.label}
                    </Badge>
                  </span>
                ))}
                {column.notes}
              </div>
            ))}
          </>
        )}

        <div
          className="sticky left-0 z-30 bg-(--tl-surface)"
          style={{ height: gridHeight }}
        >
          {hours.map((hour) => (
            <div
              key={hour}
              style={{ height: HOUR_PX }}
              className="-translate-y-2 pr-2 text-right text-[12px] leading-4 whitespace-nowrap text-(--tl-muted) tabular-nums"
            >
              {hour === first ? "" : formatHour(hour)}
            </div>
          ))}
        </div>

        {columns.map((column) => (
          <div
            key={column.id}
            className={cn(
              "relative min-w-0 border-l border-(--tl-border)",
              column.isToday ? "bg-(--tl-tint)" : "bg-(--tl-surface)",
            )}
            style={{ height: gridHeight }}
          >
            {(column.availability ?? []).map((band) => (
              <div
                key={band.start}
                aria-hidden
                style={{ top: toTop(band.start), height: toHeight(band.start, band.end) }}
                className="absolute inset-x-0 bg-(--tl-green-tint)"
              />
            ))}
            {hours.map((hour) => {
              const time = toWireTime(hour * MINUTES_PER_HOUR);
              const label = column.createLabel(time);
              return (
                <button
                  key={hour}
                  type="button"
                  tabIndex={-1}
                  aria-label={label}
                  title={label}
                  onClick={() => onCreateAt(column.id, time)}
                  style={{ top: (hour - first) * HOUR_PX, height: HOUR_PX }}
                  className={cn(
                    "group absolute inset-x-0 flex cursor-cell items-start justify-end border-t border-(--tl-border) p-1 transition-colors duration-150",
                    column.isToday ? "hover:bg-(--tl-tint-strong)" : "hover:bg-(--tl-tint)",
                  )}
                >
                  <span
                    aria-hidden
                    className="flex items-center gap-0.5 text-[12px] leading-4 font-semibold text-(--tl-link) opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                  >
                    <Plus className="size-3" />
                    {formatHour(hour)}
                  </span>
                </button>
              );
            })}
            {placeBlocks(column.blocks).map(({ block, lane, lanes }) => {
              const height = toHeight(block.startTime, block.endTime) - 2;
              return (
                <div
                  key={block.id}
                  style={{
                    top: toTop(block.startTime) + 1,
                    height,
                    left: `calc(${(lane / lanes) * 100}% + ${LANE_GUTTER_PX}px)`,
                    width: `calc(${100 / lanes}% - ${LANE_GUTTER_PX * 2}px)`,
                  }}
                  className="absolute z-10 focus-within:z-20 hover:z-20"
                >
                  <BookingBlock
                    {...block}
                    layout="fill"
                    heightPx={height}
                    onOpen={() => onOpen(block.id)}
                  />
                </div>
              );
            })}
            {column.hasNow && nowTime && isNowInRange(nowTime) && (
              <div
                aria-hidden
                style={{ top: toTop(nowTime) }}
                className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-(--tl-danger)"
              >
                {column.id === firstNowColumn && (
                  <span className="absolute -top-1 -left-1 size-2.5 rounded-full bg-(--tl-danger)" />
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
