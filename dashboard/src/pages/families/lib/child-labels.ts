// How a Child's details read on a card.
import { formatClock, formatDay } from "@/components/kit/format";
import { gradeName } from "@/lib/grades/grades";
import type { ChildDetail } from "@/types/families";

const CLOCK_LENGTH = 5;

// "Grade 5 · Lincoln Elementary"; "Grade not set" when null.
export function getGradeLine(
  gradeLevel: number | null,
  schoolName: string,
): string {
  const grade = gradeLevel === null ? "Grade not set" : gradeName(gradeLevel);
  return schoolName.trim() ? `${grade} · ${schoolName.trim()}` : grade;
}

// "Math Grade 5 · Reading Grade 4".
export function getLevelsLine(levels: ChildDetail["levels"]): string {
  if (levels.length === 0) return "No Subject levels yet";
  return levels
    .map((level) => `${level.name} ${gradeName(level.level)}`)
    .join(" · ");
}

// "Thu, Oct 15, 3:30 PM · Ana".
export function getNextLine(session: ChildDetail["next_session"]): string {
  if (!session) return "Nothing booked";
  const day = formatDay(session.scheduled_date, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = formatClock(session.start_time.slice(0, CLOCK_LENGTH));
  const [tutorFirstName] = session.tutor.name.split(" ");
  return `${day}, ${time} · ${tutorFirstName}`;
}
