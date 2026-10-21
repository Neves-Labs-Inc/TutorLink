// Which view the link page shows, from the token, the link check and the
// last save. Every outcome has one; nothing falls through to a blank page.
import type { LinkLookupResult, PasswordLink, PasswordLinkKind } from "@/lib/api";

export type LinkView =
  | { name: "checking" }
  | { name: "form"; link: PasswordLink & { kind: PasswordLinkKind } }
  | { name: "dead"; kind: PasswordLinkKind; state: "expired" | "used" }
  | { name: "invalid" }
  | { name: "rate-limited"; retryAfterSeconds: number }
  | { name: "check-failed" };

type LinkCheck = {
  hasToken: boolean;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  // A check has failed before: a retry of it keeps the failure view, not the skeleton.
  hasFailed: boolean;
  result: LinkLookupResult | undefined;
};

export function getLinkView(check: LinkCheck, isLinkSpent: boolean): LinkView {
  if (!check.hasToken) return { name: "invalid" };
  // A refetch of a query with no data resets it to pending (TanStack v5), so a retry
  // in flight after a failure reads as pending, not error.
  const isRetryingFailedCheck =
    check.hasFailed && check.isFetching && check.result === undefined;
  if (check.isError || isRetryingFailedCheck) return { name: "check-failed" };
  if (check.isPending || check.result === undefined) return { name: "checking" };

  const { result } = check;
  if (result.isRateLimited) {
    return { name: "rate-limited", retryAfterSeconds: result.retryAfterSeconds };
  }

  const { link } = result;
  let view: LinkView = { name: "invalid" };
  if (link.kind !== null && link.state === "expired") {
    view = { name: "dead", kind: link.kind, state: "expired" };
  } else if (link.kind !== null && link.state === "used") {
    view = { name: "dead", kind: link.kind, state: "used" };
  } else if (link.kind !== null && link.state === "valid") {
    // A save refused the link (400) but the re-check still calls it valid:
    // trust the refusal and show the kind's dead view.
    view =
      isLinkSpent && !check.isFetching
        ? { name: "dead", kind: link.kind, state: "expired" }
        : { name: "form", link: { ...link, kind: link.kind } };
  }
  return view;
}
