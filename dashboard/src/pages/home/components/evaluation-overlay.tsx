// Home's own details for an Evaluation to book: why the Child is in To
// do, who and where to book, and Book evaluation, which hands over to the
// booking form. Opens from list data, so it has no loading state.
import type { ReactNode } from "react";
import {
  CalendarPlus,
  GraduationCap,
  Home,
  Sparkles,
  Users,
} from "lucide-react";
import { BookingReasonBadge } from "@/components/kit/components/badges";
import { Button } from "@/components/kit/components/button";
import { DetailRow } from "@/components/kit/components/detail";
import { DetailOverlay } from "@/components/kit/overlays/detail-overlay";
import { CARD_TITLE, cn } from "@/components/kit/tokens";
import { gradeName } from "@/lib/grades/grades";
import type { ChildSummary } from "@/lib/queries/children";
import { getWaitingLabel } from "@/pages/home/lib/home-labels";

const MUTED = "text-(--tl-muted)";

function getSchoolLine(child: ChildSummary): string {
  const parts = [
    child.school_name,
    child.grade_level === null ? "" : gradeName(child.grade_level),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

type EvaluationOverlayProps = {
  child: ChildSummary | null;
  now: Date;
  onClose: () => void;
  onBook: (child: ChildSummary) => void;
};

export default function EvaluationOverlay({
  child,
  now,
  onClose,
  onBook,
}: EvaluationOverlayProps): ReactNode {
  return (
    <DetailOverlay
      isOpen={child !== null}
      onClose={onClose}
      title={child ? `Evaluation to book: ${child.name}` : "Evaluation to book"}
      backLabel="Home"
      phoneMode="page"
      header={
        child && (
          <div className="flex flex-col gap-1">
            <div className="flex">
              <BookingReasonBadge reason="evaluation_to_book" />
            </div>
            <h2 className="kit-display mt-2 text-[22px] leading-[30px] font-bold">
              {child.name}
            </h2>
          </div>
        )
      }
      footer={
        child && (
          <Button
            variant="primary"
            icon={CalendarPlus}
            onClick={() => onBook(child)}
          >
            Book evaluation
          </Button>
        )
      }
    >
      {child && <EvaluationBody child={child} now={now} />}
    </DetailOverlay>
  );
}

type EvaluationBodyProps = { child: ChildSummary; now: Date };

function EvaluationBody({ child, now }: EvaluationBodyProps): ReactNode {
  return (
    <div className="flex flex-col gap-4 pt-2">
      <section className="rounded-[16px] bg-(--tl-pink-tint) p-4 text-(--tl-pink-ink)">
        <h3 className={cn(CARD_TITLE, "flex items-center gap-2")}>
          <Sparkles aria-hidden className="size-[18px]" />
          {getWaitingLabel(child.created_at, now)}
        </h3>
        <p className="mt-1 text-[14px] leading-5">
          Not Evaluated yet and no Evaluation booked. Book one with an Admin
          or Manager so the bot can start offering sessions.
        </p>
      </section>
      <DetailRow icon={Users} label="Guardians">
        {child.guardians.length > 0 ? (
          child.guardians.map((guardian) => guardian.name).join(", ")
        ) : (
          <span className={MUTED}>No Guardian linked</span>
        )}
      </DetailRow>
      <DetailRow icon={Home} label="Can be booked at">
        {child.homes.length > 0 ? (
          child.homes.map((home) => (
            <span key={home.id} className="block">
              {home.address}
            </span>
          ))
        ) : (
          <span className={MUTED}>No home yet: In office only</span>
        )}
      </DetailRow>
      <DetailRow icon={GraduationCap} label="School">
        {getSchoolLine(child)}
      </DetailRow>
    </div>
  );
}
