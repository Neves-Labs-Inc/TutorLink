// A Session as its Tutor sees it: when, Subject level, Child notes, where
// with directions and a maps link. Tutors reach Guardians through the
// office, so Guardians are named but never contactable (#183).
// Mark completed confirms first and has no Undo: a named DESIGN §11.6
// exception, since a Tutor can't re-open a Session; the office does.
import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpen,
  Building2,
  CalendarDays,
  Check,
  MapPin,
  Navigation,
  Phone,
  SearchX,
  Signpost,
  Users,
} from "lucide-react";
import { Badge, BookingStatusBadge, KindBadge } from "@/components/kit/components/badges";
import { Button, ButtonLink } from "@/components/kit/components/button";
import { DetailRow, NotesCard } from "@/components/kit/components/detail";
import { formatDay } from "@/components/kit/format";
import { DetailOverlay } from "@/components/kit/overlays/detail-overlay";
import { ConfirmDialog } from "@/components/kit/overlays/dialog";
import { useToast } from "@/components/kit/overlays/use-toast";
import { EmptyState, ErrorState, Skeleton } from "@/components/kit/states/states";
import { errorStatus } from "@/lib/api";
import { formatPhoneForDisplay } from "@/lib/guardians/guardians";
import {
  bookingQueries,
  invalidateBookingData,
  updateBookingStatus,
} from "@/lib/queries/bookings";
import type { BookingDetail } from "@/lib/queries/bookings";
import {
  getDurationMinutes,
  getFirstName,
  getLevelName,
  getMapsUrl,
  getTimeRange,
  isInOffice,
} from "@/pages/sessions/lib/session-labels";
import { canMarkCompleted, isNotMarked } from "@/pages/sessions/lib/session-rules";

const FORBIDDEN = 403;
const NOT_FOUND = 404;
const FALLBACK_TITLE = "Session details";
const BACK_LABEL = "My sessions";
const WELL = "rounded-[16px] bg-(--tl-surface-sunk) p-4 text-[14px] leading-6";
const DETAIL_ROW_SKELETONS = 4;

type SessionDetailsProps = {
  sessionId: string | null;
  officePhone: string | null;
  now: Date;
  onClose: () => void;
};

type OverlayContent = {
  title: string;
  header?: ReactNode;
  footer?: ReactNode;
  body: ReactNode;
};

export function SessionDetails({
  sessionId,
  officePhone,
  now,
  onClose,
}: SessionDetailsProps): ReactNode {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  // Set on success; the next commit, after the dialog hands focus back, moves it on.
  const shouldFocusHeadingRef = useRef(false);
  const detail = useQuery({
    // The id comes from the URL; the query encodes it, so it can't reach another API path.
    ...bookingQueries.detail(sessionId ?? ""),
    enabled: sessionId !== null,
  });

  const mark = useMutation({
    mutationFn: (session: BookingDetail) =>
      updateBookingStatus(session.id, "completed", {
        expected_updated_at: session.updated_at,
      }),
    onSuccess: (_result, session) => {
      queryClient.setQueryData(bookingQueries.detail(session.id).queryKey, {
        ...session,
        status: "completed",
        sort_out_reasons: [],
      });
      setIsConfirming(false);
      shouldFocusHeadingRef.current = true;
      showToast({
        tone: "success",
        message: `Session with ${getFirstName(session.child.name)} marked Completed.`,
      });
      void invalidateBookingData(queryClient);
    },
    onError: () => {
      setIsConfirming(false);
      showToast({
        tone: "error",
        message: "Couldn’t mark it completed. Refresh and try again.",
      });
      void invalidateBookingData(queryClient);
    },
  });

  // After the dialog has handed focus back, land on the Child's name.
  useEffect(() => {
    if (!shouldFocusHeadingRef.current) return;
    shouldFocusHeadingRef.current = false;
    headingRef.current?.focus();
  });

  const session = detail.data ?? null;
  const status = detail.error ? errorStatus(detail.error) : null;
  const isMissing = status === FORBIDDEN || status === NOT_FOUND;

  let content: OverlayContent = {
    title: FALLBACK_TITLE,
    header: (
      <div className="flex gap-2">
        <Skeleton className="h-7 w-24 rounded-full" />
        <Skeleton className="h-7 w-24 rounded-full" />
      </div>
    ),
    body: <DetailsSkeleton />,
  };
  // A 403/404 refetch (reassigned or removed meanwhile) wins over the stale copy.
  if (session && !isMissing) {
    const canMark = canMarkCompleted(session, now);
    content = {
      title: `Session with ${session.child.name}`,
      header: <DetailsBadges session={session} now={now} />,
      // No footer at all when there's nothing in it; the overlay draws its bar for any node.
      footer:
        canMark || officePhone ? (
          <DetailsFooter
            canMark={canMark}
            officePhone={officePhone}
            onMark={() => setIsConfirming(true)}
          />
        ) : undefined,
      body: <DetailsBody session={session} officePhone={officePhone} headingRef={headingRef} />,
    };
  } else if (isMissing) {
    content = {
      title: FALLBACK_TITLE,
      body: (
        <EmptyState
          isBare
          icon={SearchX}
          title="Couldn’t find this session"
          body="It may have been removed, or it isn’t yours to see."
          action={
            <Button variant="outline" icon={ArrowLeft} onClick={onClose}>
              Back to My sessions
            </Button>
          }
        />
      ),
    };
  } else if (detail.isError) {
    content = {
      title: FALLBACK_TITLE,
      body: (
        <ErrorState
          isBare
          title="Couldn’t load this session"
          body="Check your connection and try again."
          onRetry={() => void detail.refetch()}
          isRetrying={detail.isFetching}
        />
      ),
    };
  }

  return (
    <>
      <DetailOverlay
        isOpen={sessionId !== null}
        onClose={onClose}
        title={content.title}
        backLabel={BACK_LABEL}
        phoneMode="page"
        header={content.header}
        footer={content.footer}
      >
        {content.body}
      </DetailOverlay>
      <ConfirmDialog
        isOpen={isConfirming}
        onClose={() => setIsConfirming(false)}
        onConfirm={() => session && mark.mutate(session)}
        title="Mark this session completed?"
        confirmLabel="Mark completed"
        keepLabel="Not yet"
        isWorking={mark.isPending}
      >
        The office can re-open it if it’s a mistake.
      </ConfirmDialog>
    </>
  );
}

type DetailsBadgesProps = { session: BookingDetail; now: Date };

function DetailsBadges({ session, now }: DetailsBadgesProps): ReactNode {
  return (
    <div className="flex flex-wrap gap-2">
      <KindBadge kind={session.kind} />
      {isNotMarked(session, now) ? (
        <Badge tone="warning" hasDot>
          Not marked
        </Badge>
      ) : (
        <BookingStatusBadge status={session.status} />
      )}
    </div>
  );
}

type DetailsFooterProps = {
  canMark: boolean;
  officePhone: string | null;
  onMark: () => void;
};

function DetailsFooter({ canMark, officePhone, onMark }: DetailsFooterProps): ReactNode {
  return (
    <>
      {canMark && (
        <Button variant="primary" icon={Check} isFullWidth className="@md:flex-1" onClick={onMark}>
          Mark completed
        </Button>
      )}
      {officePhone && (
        <ButtonLink icon={Phone} href={`tel:${officePhone}`} isFullWidth className="@md:flex-1">
          Call the office
        </ButtonLink>
      )}
    </>
  );
}

type DetailsBodyProps = {
  session: BookingDetail;
  officePhone: string | null;
  headingRef: RefObject<HTMLHeadingElement | null>;
};

function DetailsBody({ session, officePhone, headingRef }: DetailsBodyProps): ReactNode {
  const isEvaluation = session.kind === "evaluation";
  return (
    <>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="kit-display text-[28px] leading-9 font-light outline-none"
      >
        {session.child.name}
      </h2>
      <div className="mt-6 flex flex-col gap-5">
        <DetailRow icon={CalendarDays} label="When">
          <p className="font-semibold">
            {formatDay(session.scheduled_date, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
          <p className="text-(--tl-ink-soft) tabular-nums">
            {getTimeRange(session)} · {getDurationMinutes(session)} min
          </p>
        </DetailRow>
        <DetailRow icon={BookOpen} label={isEvaluation ? "What" : "Subject level"}>
          {isEvaluation ? (
            <>
              <p className="font-semibold">Evaluation session</p>
              <p className="text-(--tl-ink-soft)">You’ll assess their Subject levels.</p>
            </>
          ) : (
            <p className="font-semibold">
              {session.subject?.name} · {getLevelName(session.subject_level)}
            </p>
          )}
        </DetailRow>
        {session.child.notes ? (
          <NotesCard>{session.child.notes}</NotesCard>
        ) : (
          <p className={`${WELL} text-(--tl-muted)`}>No Child notes from the office.</p>
        )}
        <LocationRow session={session} />
        <DetailRow icon={Users} label={session.guardians.length === 1 ? "Guardian" : "Guardians"}>
          {session.guardians.length > 0 && (
            <p className="font-semibold">
              {session.guardians.map((guardian) => guardian.name).join(", ")}
            </p>
          )}
          <p className="text-[14px] text-(--tl-ink-soft)">
            {getBookedByLine(session)} {getReachLine(officePhone)}
          </p>
        </DetailRow>
      </div>
    </>
  );
}

function getBookedByLine(session: BookingDetail): string {
  return session.booked_by_guardian
    ? `Booked by ${getFirstName(session.booked_by_guardian.name)} through the bot.`
    : "Booked by the office.";
}

function getReachLine(officePhone: string | null): string {
  return officePhone
    ? `To reach them, call the office at ${formatPhoneForDisplay(officePhone)}.`
    : "To reach them, call the office.";
}

function LocationRow({ session }: { session: BookingDetail }): ReactNode {
  if (isInOffice(session) || !session.home) {
    return (
      <DetailRow icon={Building2} label="Location">
        <p className="font-semibold">In office</p>
        {session.office_address && (
          <p className="text-(--tl-ink-soft)">{session.office_address}</p>
        )}
      </DetailRow>
    );
  }

  const { home } = session;
  return (
    <>
      <DetailRow icon={MapPin} label="Location">
        {home.label && (
          <p className="text-[13px] leading-[18px] font-semibold text-(--tl-muted)">
            {home.label} home
          </p>
        )}
        <p className="font-semibold">{home.address}</p>
      </DetailRow>
      <div className={`${WELL} flex flex-col gap-3`}>
        <p className="flex items-start gap-2">
          <Signpost aria-hidden className="mt-1 size-4 shrink-0 text-(--tl-muted)" />
          {home.directions ?? (
            <span className="text-(--tl-muted)">No directions saved for this Home.</span>
          )}
        </p>
        <ButtonLink
          // Outline: the soft tint barely shows on the sunk well.
          variant="outline"
          icon={Navigation}
          href={getMapsUrl(home.address)}
          target="_blank"
          rel="noreferrer"
          isFullWidth
        >
          Get directions
          <span className="sr-only"> (opens in a new tab)</span>
        </ButtonLink>
      </div>
    </>
  );
}

function DetailsSkeleton(): ReactNode {
  return (
    <div role="status" aria-label="Loading the session" className="flex flex-col">
      <Skeleton className="h-8 w-1/2 rounded-full" />
      <div className="mt-6 flex flex-col gap-5">
        {Array.from({ length: DETAIL_ROW_SKELETONS }, (_, index) => (
          <div key={index} className="flex gap-3">
            <Skeleton className="size-10 shrink-0 rounded-[14px]" />
            <div className="flex flex-1 flex-col gap-2 pt-1">
              <Skeleton className="h-3 w-1/4 rounded-full" />
              <Skeleton className="h-4 w-3/5 rounded-full" />
            </div>
          </div>
        ))}
        <Skeleton className="h-20 rounded-[18px]" />
      </div>
    </div>
  );
}
