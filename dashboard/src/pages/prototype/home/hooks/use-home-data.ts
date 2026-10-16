// Fakes Home's reads for the switcher's `state` param, and the writes
// Home makes (approve, decline, mark done) against local copies. The
// real page would use TanStack Query with refetchOnWindowFocus and
// refetchInterval: 60s (TutorLink#189); here a timer just bumps
// "Updated <time>" so the cue can be judged.
import { useCallback, useEffect, useState } from "react";
import {
  getEmpty,
  getPopulated,
  NOW,
} from "@/pages/prototype/home/lib/mock-api";
import type { HomeData, OfficeRole } from "@/pages/prototype/home/lib/mock-api";
import type {
  BookingSummary,
  ExceptionRead,
  Page,
} from "@/pages/prototype/home/types/api";

export type HomeState = "populated" | "loading" | "empty" | "error" | "stale";

export type Phase = "loading" | "error" | "ready";

const FAKE_LATENCY_MS = 700;
const REFRESH_EVERY_MS = 60_000;

export type HomeDataApi = {
  phase: Phase;
  data: HomeData | null;
  // The last refresh failed but the earlier data is still on screen.
  isStale: boolean;
  updatedAt: Date;
  retry: () => void;
  // Approving pass the request's clashing Bookings; declining passes [].
  removeTimeOff: (item: ExceptionRead, clashes: BookingSummary[]) => void;
  removeChat: (id: string) => void;
  removeSortOut: (id: string) => void;
  removeEvaluation: (id: string) => void;
};

function getInitialData(role: OfficeRole, state: HomeState): HomeData | null {
  let data: HomeData | null = null;
  if (state === "populated" || state === "stale") {
    data = getPopulated(role);
  } else if (state === "empty") {
    data = getEmpty(role);
  }
  return data;
}

function getInitialPhase(state: HomeState): Phase {
  let phase: Phase = "ready";
  if (state === "loading") {
    phase = "loading";
  } else if (state === "error") {
    phase = "error";
  }
  return phase;
}

export function useHomeData(role: OfficeRole, state: HomeState): HomeDataApi {
  const [phase, setPhase] = useState<Phase>(() => getInitialPhase(state));
  const [data, setData] = useState<HomeData | null>(() =>
    getInitialData(role, state),
  );
  const [isStale, setIsStale] = useState(state === "stale");
  const [updatedAt, setUpdatedAt] = useState(() => new Date(NOW));

  useEffect(() => {
    if (phase !== "ready" || isStale) return;
    const timer = window.setInterval(
      () => setUpdatedAt((previous) => new Date(previous.getTime() + REFRESH_EVERY_MS)),
      REFRESH_EVERY_MS,
    );
    return () => window.clearInterval(timer);
  }, [phase, isStale]);

  const retry = useCallback(() => {
    if (isStale) {
      setIsStale(false);
      setUpdatedAt((previous) => new Date(previous.getTime() + REFRESH_EVERY_MS));
      return;
    }
    setPhase("loading");
    window.setTimeout(() => {
      setData(getPopulated(role));
      setPhase("ready");
    }, FAKE_LATENCY_MS);
  }, [isStale, role]);

  // Approving over clashing Bookings puts them in To do › Bookings.
  const removeTimeOff = useCallback(
    (item: ExceptionRead, clashes: BookingSummary[]) => {
      setData((previous) => {
        if (!previous?.timeOff) return previous;
        const pending = previous.counts.time_off_pending ?? 0;
        const sortOut = previous.sortOut
          ? withItems(previous.sortOut, [...previous.sortOut.items, ...clashes])
          : null;
        return {
          ...previous,
          counts: {
            ...previous.counts,
            time_off_pending: Math.max(0, pending - 1),
            bookings_to_sort_out:
              previous.counts.bookings_to_sort_out + clashes.length,
          },
          timeOff: withItems(
            previous.timeOff,
            previous.timeOff.items.filter((entry) => entry.id !== item.id),
          ),
          sortOut,
        };
      });
    },
    [],
  );

  const removeChat = useCallback((id: string) => {
    setData((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        counts: {
          ...previous.counts,
          needs_attention: Math.max(0, previous.counts.needs_attention - 1),
        },
        chats: withItems(
          previous.chats,
          previous.chats.items.filter((item) => item.id !== id),
        ),
      };
    });
  }, []);

  const removeSortOut = useCallback((id: string) => {
    setData((previous) => {
      if (!previous?.sortOut) return previous;
      return {
        ...previous,
        counts: {
          ...previous.counts,
          bookings_to_sort_out: Math.max(0, previous.counts.bookings_to_sort_out - 1),
        },
        sortOut: withItems(
          previous.sortOut,
          previous.sortOut.items.filter((item) => item.id !== id),
        ),
      };
    });
  }, []);

  const removeEvaluation = useCallback((id: string) => {
    setData((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        counts: {
          ...previous.counts,
          children_awaiting_evaluation: Math.max(
            0,
            previous.counts.children_awaiting_evaluation - 1,
          ),
        },
        evaluations: withItems(
          previous.evaluations,
          previous.evaluations.items.filter((item) => item.id !== id),
        ),
      };
    });
  }, []);

  return {
    phase,
    data,
    isStale,
    updatedAt,
    retry,
    removeTimeOff,
    removeChat,
    removeSortOut,
    removeEvaluation,
  };
}

// A page with new items; `total` follows, as the next refetch would say.
function withItems<P extends Page<T>, T>(page: P, items: T[]): P {
  return { ...page, items, total: items.length };
}

