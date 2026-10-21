// What a failed sign-in means for the page, decided from the response alone.
// The copy never names which bucket (email or network) tripped a lockout.
import { pluralize } from "@/components/kit/format";

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
// The API's longest lockout; used when Retry-After is missing or unreadable.
const FALLBACK_LOCKOUT_SECONDS = 15 * SECONDS_PER_MINUTE;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;

// Epoch milliseconds: when the lockout began and when it ends.
export type Lockout = { from: number; until: number };

export type SignInFailure =
  | { kind: "wrong" }
  | { kind: "locked"; lockout: Lockout }
  | { kind: "unreachable" };

export function parseRetryAfter(header: string | null): number {
  // Number("") is 0 and an HTTP date is NaN; both fall through to the fallback.
  const seconds = Number(header);
  const isUsable = header !== null && Number.isInteger(seconds) && seconds > 0;
  return isUsable ? seconds : FALLBACK_LOCKOUT_SECONDS;
}

// Any other 4xx is the server refusing these details, so it reads as wrong.
export function getSignInFailure(
  status: number | null,
  retryAfter: string | null,
  now: number,
): SignInFailure {
  if (status === null || status >= HTTP_SERVER_ERROR) return { kind: "unreachable" };
  if (status !== HTTP_TOO_MANY_REQUESTS) return { kind: "wrong" };

  const until = now + parseRetryAfter(retryAfter) * MS_PER_SECOND;
  return { kind: "locked", lockout: { from: now, until } };
}

// "1 minute" / "N minutes", rounded up: the wait is never undersold.
export function formatWait(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / SECONDS_PER_MINUTE));
  return pluralize(minutes, "minute", "minutes");
}
