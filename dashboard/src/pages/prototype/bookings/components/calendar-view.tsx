// Calendar view. From 768px: a time grid, either the week (a column per
// day) or one day with a column per Staff member, their availability
// shaded green, so "who is free at 4?" is answered by looking. On phones
// both are a day agenda under a 7-day strip. Tapping empty time starts
// a New booking there.
import type { ReactNode } from "react";
import { CalendarPlus, CalendarX2, Plane } from "lucide-react";
import { Avatar } from "@/pages/prototype/shell-kit/kit/components/badges";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import { EmptyState } from "@/pages/prototype/shell-kit/kit/states/states";
import { cn } from "@/pages/prototype/shell-kit/kit/tokens";
import TimeGrid from "@/pages/prototype/bookings/components/time-grid";
import type { GridColumn } from "@/pages/prototype/bookings/components/time-grid";
import { DayTable } from "@/pages/prototype/bookings/components/bookings-list";
import {
  APPROVED_TIME_OFF,
  AVAILABILITY,
  NOW_TIME,
  STAFF,
  TODAY,
} from "@/pages/prototype/bookings/lib/mock-data";
import {
  formatDay,
  formatLongDay,
  formatShortDay,
  formatTime,
  getFirstName,
  getWeekDays,
  getWeekday,
} from "@/pages/prototype/bookings/lib/format";
import type { BookingSummary } from "@/pages/prototype/bookings/lib/wire";

export type CreateAt = { date: string; time: string | null; userId: string | null };

function getTimeOffOn(day: string): { userId: string; name: string }[] {
  return APPROVED_TIME_OFF.filter(
    (timeOff) => timeOff.start_date <= day && timeOff.end_date >= day,
  ).map((timeOff) => ({ userId: timeOff.staff.id, name: timeOff.staff.name }));
}

function getWeekColumns(
  rows: BookingSummary[],
  weekStart: string,
  onCreateAt: (at: CreateAt) => void,
): GridColumn[] {
  return getWeekDays(weekStart).map((day) => ({
    id: day,
    isToday: day === TODAY,
    header: (
      <span className="flex flex-col items-center">
        <span className="text-[12px] font-semibold tracking-[0.1em] text-(--tl-muted) uppercase">
          {formatDay(day, { weekday: "short" })}
        </span>
        <span
          className={cn(
            "kit-display mt-0.5 inline-flex size-9 items-center justify-center rounded-full text-[18px] font-bold",
            day === TODAY && "bg-(--tl-primary) text-(--tl-on-primary)",
          )}
        >
          {formatDay(day, { day: "numeric" })}
        </span>
      </span>
    ),
    bookings: rows.filter((row) => row.scheduled_date === day),
    notes: getTimeOffOn(day).map((off) => `${getFirstName(off.name)} off`),
    createLabel: (time) => `New booking ${formatShortDay(day)} at ${formatTime(time)}`,
    onCreateAt: (time) => onCreateAt({ date: day, time, userId: null }),
  }));
}

function getDayColumns(
  rows: BookingSummary[],
  day: string,
  onCreateAt: (at: CreateAt) => void,
): GridColumn[] {
  const weekday = getWeekday(day);
  const dayRows = rows.filter((row) => row.scheduled_date === day);
  const offIds = getTimeOffOn(day).map((off) => off.userId);
  const staff = STAFF.filter(
    (person) =>
      dayRows.some((row) => row.staff.id === person.id) ||
      (!person.archived &&
        AVAILABILITY.some((range) => range.userId === person.id && range.weekday === weekday)),
  );
  return staff.map((person) => {
    const isOff = offIds.includes(person.id);
    return {
      id: person.id,
      header: (
        <span className="flex flex-col items-center gap-1">
          <Avatar name={person.name} size="sm" />
          <span className="max-w-full truncate text-[13px] font-semibold">
            {getFirstName(person.name)}
          </span>
        </span>
      ),
      bookings: dayRows.filter((row) => row.staff.id === person.id),
      freeBands: isOff
        ? []
        : AVAILABILITY.filter(
            (range) => range.userId === person.id && range.weekday === weekday,
          ).map((range) => ({ start: `${range.from}:00`, end: `${range.to}:00` })),
      notes: [
        ...(isOff ? ["Time off"] : []),
        ...(person.archived ? ["Archived"] : []),
      ],
      createLabel: (time) =>
        `New booking with ${person.name}, ${formatShortDay(day)} at ${formatTime(time)}`,
      onCreateAt: (time) => onCreateAt({ date: day, time, userId: person.id }),
    };
  });
}

type DayStripProps = {
  weekStart: string;
  day: string;
  rows: BookingSummary[];
  onDayChange: (day: string) => void;
};

function DayStrip({ weekStart, day, rows, onDayChange }: DayStripProps): ReactNode {
  return (
    <div role="group" aria-label="Day" className="grid w-full max-w-[520px] grid-cols-7 gap-1">
      {getWeekDays(weekStart).map((key) => {
        const isSelected = key === day;
        const count = rows.filter((row) => row.scheduled_date === key).length;
        const needsSorting = rows.some(
          (row) => row.scheduled_date === key && row.sort_out_reasons.length > 0,
        );
        return (
          <button
            key={key}
            type="button"
            aria-pressed={isSelected}
            aria-label={`${formatLongDay(key)}, ${count} bookings`}
            onClick={() => onDayChange(key)}
            className={cn(
              "flex min-h-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-[16px] text-[12px] transition-colors duration-150",
              isSelected
                ? "bg-(--tl-primary) text-(--tl-on-primary)"
                : "bg-(--tl-surface) text-(--tl-ink-soft) hover:bg-(--tl-tint)",
              key === TODAY && !isSelected && "ring-2 ring-(--tl-primary) ring-inset",
            )}
          >
            <span className="font-semibold uppercase">{formatDay(key, { weekday: "narrow" })}</span>
            <span className="kit-display text-[17px] font-bold">{formatDay(key, { day: "numeric" })}</span>
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                count === 0 && "bg-transparent",
                count > 0 && (needsSorting ? "bg-(--tl-warning)" : isSelected ? "bg-(--tl-on-primary)" : "bg-(--tl-primary)"),
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

type AgendaProps = {
  rows: BookingSummary[];
  weekStart: string;
  day: string;
  onDayChange: (day: string) => void;
  onOpen: (booking: BookingSummary) => void;
  onCreateAt: (at: CreateAt) => void;
};

function Agenda({ rows, weekStart, day, onDayChange, onOpen, onCreateAt }: AgendaProps): ReactNode {
  const dayRows = rows.filter((row) => row.scheduled_date === day);
  const offToday = getTimeOffOn(day);
  return (
    <div className="flex flex-col gap-4">
      <DayStrip weekStart={weekStart} day={day} rows={rows} onDayChange={onDayChange} />
      <h2 className="kit-display px-1 text-[18px] font-bold">{formatLongDay(day)}</h2>
      {offToday.map((off) => (
        <p
          key={off.userId}
          className="flex items-center gap-2 rounded-full bg-(--tl-yellow-tint) px-4 py-2 text-[13px] font-semibold text-(--tl-yellow-ink)"
        >
          <Plane aria-hidden className="size-4" />
          {off.name} is off (approved Time off)
        </p>
      ))}
      {dayRows.length > 0 ? (
        <DayTable rows={dayRows} onOpen={onOpen} />
      ) : (
        <EmptyState
          icon={CalendarX2}
          title="Nothing booked"
          body="No bookings on this day."
        />
      )}
      <Button
        variant="soft"
        icon={CalendarPlus}
        isFullWidth
        onClick={() => onCreateAt({ date: day, time: null, userId: null })}
      >
        New booking on {formatDay(day, { weekday: "long" })}
      </Button>
    </div>
  );
}

type CalendarViewProps = AgendaProps & { scale: "week" | "day" };

export default function CalendarView({
  rows,
  weekStart,
  scale,
  day,
  onDayChange,
  onOpen,
  onCreateAt,
}: CalendarViewProps): ReactNode {
  const columns =
    scale === "week"
      ? getWeekColumns(rows, weekStart, onCreateAt)
      : getDayColumns(rows, day, onCreateAt);
  return (
    <div className="@container">
      <div className="hidden @3xl:block">
        {scale === "day" && (
          <div className="mb-3 flex items-center justify-between gap-6">
            <DayStrip weekStart={weekStart} day={day} rows={rows} onDayChange={onDayChange} />
            <p className="flex items-center gap-2 text-[13px] text-(--tl-muted)">
              <span aria-hidden className="size-3 rounded-[4px] bg-(--tl-green-tint) ring-1 ring-(--tl-green-ink)/30" />
              Available (from My availability)
            </p>
          </div>
        )}
        <TimeGrid
          columns={columns}
          nowTime={NOW_TIME}
          showsStaff={scale === "week"}
          onOpen={onOpen}
          minColumnPx={scale === "week" ? 110 : 130}
        />
      </div>
      <div className="@3xl:hidden">
        <Agenda
          rows={rows}
          weekStart={weekStart}
          day={day}
          onDayChange={onDayChange}
          onOpen={onOpen}
          onCreateAt={onCreateAt}
        />
      </div>
    </div>
  );
}
