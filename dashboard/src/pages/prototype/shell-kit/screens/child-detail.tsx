// A Child's profile in the DetailOverlay: grades, next booking, their
// Guardians (each links to Guardian details), and the Homes the Child
// can be booked at, read-only. Homes are managed on Guardian details.
import type { ReactNode } from "react";
import {
  BookOpen,
  Building2,
  CalendarDays,
  ChevronRight,
  GraduationCap,
  MapPin,
} from "lucide-react";
import {
  BOOKINGS,
  formatAddress,
  getGuardiansOf,
} from "@/pages/prototype/shell-kit/kit/mock-data";
import type { Child, Guardian } from "@/pages/prototype/shell-kit/kit/mock-data";
import { formatDay, formatTime, getDayKey } from "@/pages/prototype/shell-kit/kit/format";
import { CARD, cn, EYEBROW } from "@/pages/prototype/shell-kit/kit/tokens";
import {
  Avatar,
  EvaluatedBadge,
  RemindersBadge,
} from "@/pages/prototype/shell-kit/kit/components/badges";
import { Button, TextLink } from "@/pages/prototype/shell-kit/kit/components/button";
import { DetailRow } from "@/pages/prototype/shell-kit/kit/components/detail";
import { DetailOverlay } from "@/pages/prototype/shell-kit/kit/overlays/detail-overlay";
import { useHomes } from "@/pages/prototype/shell-kit/screens/use-homes";

type ChildDetailProps = {
  child: Child;
  backLabel: string;
  onBack: () => void;
  onClose: () => void;
  onOpenGuardian: (guardian: Guardian) => void;
};

export default function ChildDetail({
  child,
  backLabel,
  onBack,
  onClose,
  onOpenGuardian,
}: ChildDetailProps): ReactNode {
  const { homes } = useHomes();
  const guardians = getGuardiansOf(child.name);
  const childHomes = homes.filter(
    (home) =>
      !home.isArchived &&
      guardians.some((guardian) => guardian.id === home.guardianId),
  );
  const nextBooking =
    BOOKINGS.filter(
      (booking) => booking.child === child.name && booking.status !== "Cancelled",
    ).sort((a, b) => a.start.localeCompare(b.start))[0] ?? null;

  return (
    <DetailOverlay
      isOpen
      onClose={onClose}
      onBack={onBack}
      title={`Child: ${child.name}`}
      backLabel={backLabel}
      phoneMode="page"
      header={<EvaluatedBadge isEvaluated={child.isEvaluated} />}
      footer={
        <Button variant="primary" isFullWidth icon={CalendarDays}>
          {child.isEvaluated ? "New booking" : "Book evaluation"}
        </Button>
      }
    >
      <div className="flex items-center gap-4">
        <Avatar name={child.name} size="lg" />
        <h2 className="kit-display min-w-0 truncate text-[28px] leading-9 font-light">
          {child.name}
        </h2>
      </div>
      <div className="mt-6 flex flex-col gap-5">
        <DetailRow icon={GraduationCap} label="Overall grade">
          <p className="font-semibold">{child.overallGrade}</p>
        </DetailRow>
        <DetailRow icon={BookOpen} label="Subject levels">
          <p className="font-semibold">
            {child.subjects.length > 0
              ? child.subjects.join(", ")
              : "None yet: set after the Evaluation session"}
          </p>
        </DetailRow>
        <DetailRow icon={CalendarDays} label="Next booking">
          {nextBooking ? (
            <p className="font-semibold">
              {formatDay(getDayKey(nextBooking.start), {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
              , {formatTime(nextBooking.start)} · {nextBooking.staff}
            </p>
          ) : (
            <p className="text-(--tl-muted)">Nothing booked</p>
          )}
        </DetailRow>
      </div>

      <h3 className={cn(EYEBROW, "mt-8 mb-3")}>
        {guardians.length === 1 ? "Guardian" : `Guardians · ${guardians.length}`}
      </h3>
      <ul className="flex flex-col gap-2">
        {guardians.map((guardian) => (
          <li key={guardian.id}>
            <button
              type="button"
              onClick={() => onOpenGuardian(guardian)}
              aria-label={`Open Guardian details: ${guardian.name}`}
              className={cn(
                CARD,
                "flex min-h-[72px] w-full cursor-pointer items-center gap-3 p-4 text-left transition-colors duration-150 hover:border-(--tl-hero)",
              )}
            >
              <Avatar name={guardian.name} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">
                  {guardian.name}
                </span>
                <span className="block truncate text-[13px] text-(--tl-muted) tabular-nums">
                  {guardian.phone} · {guardian.language}
                </span>
              </span>
              <span className="hidden @md:inline-flex">
                <RemindersBadge state={guardian.reminders} />
              </span>
              <ChevronRight aria-hidden className="size-5 shrink-0 text-(--tl-muted)" />
            </button>
          </li>
        ))}
      </ul>

      <h3 className={cn(EYEBROW, "mt-8 mb-1")}>Can be booked at</h3>
      <p className="mb-3 text-[13px] text-(--tl-muted)">
        Their Guardians’ Homes, plus In office. Homes are managed on Guardian
        details.
      </p>
      <ul className="flex flex-col gap-2">
        {childHomes.map((home) => {
          const owner = guardians.find((guardian) => guardian.id === home.guardianId);
          return (
            <li
              key={home.id}
              className="flex items-start gap-3 rounded-[16px] bg-(--tl-surface-sunk) px-4 py-3"
            >
              <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-(--tl-muted)" />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] leading-5 font-medium">
                  {formatAddress(home)}
                </span>
                {owner && (
                  <TextLink
                    onClick={() => onOpenGuardian(owner)}
                    className="text-[13px]"
                  >
                    {owner.name}’s Home · Manage
                  </TextLink>
                )}
              </span>
            </li>
          );
        })}
        <li className="flex items-center gap-3 rounded-[16px] bg-(--tl-surface-sunk) px-4 py-3">
          <Building2 aria-hidden className="size-4 shrink-0 text-(--tl-muted)" />
          <span className="text-[14px] font-medium">In office</span>
        </li>
      </ul>
    </DetailOverlay>
  );
}
