// /set-password, where both emails link: an Invite (Welcome) or a password
// reset (Set a new password). The link is checked first, so a dead one is
// said before any password is typed. Saving signs the person in as the
// link's account, even if someone else was signed in on this browser.
import { useEffect, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Clock, Link2Off, RotateCw, WifiOff } from "lucide-react";
import KitRoot from "@/components/kit/kit-root";
import { AuthFrame, AuthFrameSkeleton } from "@/components/kit/auth/auth-frame";
import { Button, TextLink } from "@/components/kit/components/button";
import { useAuth } from "@/hooks/useAuth";
import { useCountdown } from "@/hooks/use-countdown";
import { useTheme } from "@/hooks/use-theme";
import { requestLinkLookup } from "@/lib/api";
import type { PasswordLinkKind } from "@/lib/api";
import { formatWait } from "@/lib/auth/sign-in";
import type { Lockout } from "@/lib/auth/sign-in";
import PasswordForm from "@/pages/set-password/password-form";
import { getLinkView } from "@/pages/set-password/link-view";
import type { LinkView } from "@/pages/set-password/link-view";

const MS_PER_SECOND = 1000;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNPROCESSABLE = 422;
const LOGIN_PATH = "/login";
const FORGOT_PATH = "/forgot-password";
// The 422 only gets past the client rules for an over-long password.
const PASSWORD_REJECTED = "That password is too long. Try a shorter one.";

const FORM_COPY: Record<
  PasswordLinkKind,
  { title: string; body: string; submit: string }
> = {
  invite: {
    title: "Welcome to TutorLink",
    body: "Choose a password to finish setting up your account. You’ll sign in with it and your email from now on.",
    submit: "Set password and sign in",
  },
  reset: {
    title: "Choose a new password",
    body: "Your old password stops working once you save this one, and you’ll be signed in.",
    submit: "Save password and sign in",
  },
};

const DEAD_COPY: Record<
  PasswordLinkKind,
  { expired: string; used: string; body: string }
> = {
  invite: {
    expired: "This invite has expired",
    used: "This invite has already been used",
    body: "Invites work once, for 7 days. Ask the office to send you a new one.",
  },
  reset: {
    expired: "This reset link has expired",
    used: "This reset link has already been used",
    body: "Reset links work once, for 48 hours. Send yourself a new one.",
  },
};

type FrameProps = ComponentProps<typeof AuthFrame>;

function readStateToken(state: unknown): string | null {
  const token = (state as { token?: unknown } | null)?.token;
  return typeof token === "string" && token ? token : null;
}

// Reads the token once, then takes it out of the address bar, the history
// entry's URL and referrers. Location state keeps it for a reload; it never
// goes to web storage.
function useLinkToken(): string | null {
  const [searchParams] = useSearchParams();
  const { pathname, state } = useLocation();
  const navigate = useNavigate();
  const [token] = useState(
    () => searchParams.get("token") || readStateToken(state),
  );
  const isTokenInUrl = searchParams.has("token");

  useEffect(() => {
    if (!isTokenInUrl) return;
    navigate(pathname, { replace: true, state: token ? { token } : null });
  }, [isTokenInUrl, navigate, pathname, token]);

  return token;
}

function SignInFooter({ onSignIn }: { onSignIn: () => void }): ReactNode {
  return (
    <p>
      Already chose a password? <TextLink onClick={onSignIn}>Sign in</TextLink>
    </p>
  );
}

function BackToSignIn({ onSignIn }: { onSignIn: () => void }): ReactNode {
  return (
    <TextLink onClick={onSignIn}>
      <ArrowLeft aria-hidden className="size-4" />
      Back to sign in
    </TextLink>
  );
}

function LinkPage(): ReactNode {
  const token = useLinkToken();
  const navigate = useNavigate();
  const { setPasswordWithToken, isSettingPassword, setPasswordFailure } =
    useAuth();

  const lookup = useQuery({
    // The token keys the check so a second link opened in this tab is checked afresh.
    queryKey: ["password-link", token],
    queryFn: () => requestLinkLookup(token ?? ""),
    enabled: token !== null,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const { refetch } = lookup;

  const failureStatus = setPasswordFailure?.status ?? null;
  const isLinkSpent = failureStatus === HTTP_BAD_REQUEST;

  // The save says the link died but not how: re-check it for expired vs used.
  useEffect(() => {
    if (isLinkSpent) void refetch();
  }, [isLinkSpent, refetch]);

  const view: LinkView = getLinkView(
    {
      hasToken: token !== null,
      isPending: lookup.isPending,
      isError: lookup.isError,
      isFetching: lookup.isFetching,
      hasFailed: lookup.errorUpdateCount > 0,
      result: lookup.data,
    },
    isLinkSpent,
  );

  // Each fresh answer from the server restarts the wait.
  const lockout: Lockout | null =
    view.name === "rate-limited"
      ? {
          from: lookup.dataUpdatedAt,
          until: lookup.dataUpdatedAt + view.retryAfterSeconds * MS_PER_SECOND,
        }
      : null;
  const secondsLeft = useCountdown(lockout);

  if (view.name === "checking") {
    return <AuthFrameSkeleton label="Checking your link" />;
  }

  const handleSignIn = () => navigate(LOGIN_PATH);
  const handleNewLink = () => navigate(FORGOT_PATH);
  const handleRetry = () => void refetch();

  function getFrameProps(shown: Exclude<LinkView, { name: "checking" }>): FrameProps {
    switch (shown.name) {
      case "form": {
        const { link } = shown;
        const copy = FORM_COPY[link.kind];
        const invitee =
          link.kind === "invite" && link.email
            ? { name: link.name, email: link.email }
            : null;
        return {
          title: copy.title,
          body: copy.body,
          footer:
            link.kind === "invite" ? (
              <SignInFooter onSignIn={handleSignIn} />
            ) : (
              <BackToSignIn onSignIn={handleSignIn} />
            ),
          children: (
            <PasswordForm
              invitee={invitee}
              submitLabel={copy.submit}
              // Held through the re-check after a 400, and through navigation after a 200.
              isSubmitting={isSettingPassword || (isLinkSpent && lookup.isFetching)}
              rejectedPasswordError={
                failureStatus === HTTP_UNPROCESSABLE ? PASSWORD_REJECTED : undefined
              }
              hasSaveFailed={
                setPasswordFailure !== null &&
                failureStatus !== HTTP_BAD_REQUEST &&
                failureStatus !== HTTP_UNPROCESSABLE
              }
              onSubmit={(password) => {
                if (token) setPasswordWithToken(token, password);
              }}
            />
          ),
        };
      }
      case "dead": {
        const copy = DEAD_COPY[shown.kind];
        const isInvite = shown.kind === "invite";
        return {
          icon: Link2Off,
          tone: "warning",
          title: copy[shown.state],
          body: copy.body,
          footer: isInvite ? (
            <SignInFooter onSignIn={handleSignIn} />
          ) : (
            <BackToSignIn onSignIn={handleSignIn} />
          ),
          children: isInvite ? (
            <Button variant="outline" isFullWidth onClick={handleSignIn}>
              Go to sign in
            </Button>
          ) : (
            <Button variant="primary" isFullWidth onClick={handleNewLink}>
              Send a new link
            </Button>
          ),
        };
      }
      case "invalid":
        return {
          icon: Link2Off,
          tone: "warning",
          title: "This link no longer works",
          body: "Each link works once, and expires: invites after 7 days, password resets after 48 hours.",
          footer: <SignInFooter onSignIn={handleSignIn} />,
          children: (
            <div className="flex flex-col gap-4">
              <Button variant="primary" isFullWidth onClick={handleNewLink}>
                Send me a new reset link
              </Button>
              <p className="text-center text-[14px] leading-5 text-(--tl-muted)">
                Came from an invite email? Ask an Admin to send you a new one.
              </p>
            </div>
          ),
        };
      case "rate-limited":
        return {
          icon: Clock,
          tone: "warning",
          title: "Too many tries",
          body:
            secondsLeft > 0 ? (
              <p>
                Try again in{" "}
                <strong className="font-semibold text-(--tl-ink) tabular-nums">
                  {formatWait(secondsLeft)}
                </strong>
                .
              </p>
            ) : (
              "You can try again now."
            ),
          children:
            secondsLeft > 0 ? undefined : (
              <Button
                variant="primary"
                icon={RotateCw}
                isFullWidth
                isLoading={lookup.isFetching}
                onClick={handleRetry}
              >
                {lookup.isFetching ? "Trying again…" : "Try again"}
              </Button>
            ),
        };
      case "check-failed":
        return {
          icon: WifiOff,
          tone: "danger",
          title: "Couldn’t check your link",
          body: "Check your connection and try again.",
          children: (
            <Button
              variant="primary"
              icon={RotateCw}
              isFullWidth
              isLoading={lookup.isFetching}
              onClick={handleRetry}
            >
              {lookup.isFetching ? "Trying again…" : "Try again"}
            </Button>
          ),
        };
    }
  }

  return <AuthFrame {...getFrameProps(view)} />;
}

export default function SetPasswordPage(): ReactNode {
  const { theme } = useTheme();
  return (
    <KitRoot theme={theme}>
      <LinkPage />
    </KitRoot>
  );
}
