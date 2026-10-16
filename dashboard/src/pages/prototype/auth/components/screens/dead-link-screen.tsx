// A link that no longer works (the 400 from /auth/password/set). Today
// the page can't tell an Invite from a reset link, so "unknown" covers
// both; the other two show what knowing would buy.
import type { ReactNode } from "react";
import { ArrowLeft, Link2Off } from "lucide-react";
import { Button, TextLink } from "@/components/kit/components/button";
import AuthPage from "@/pages/prototype/auth/components/layout/auth-page";
import PrototypeNote from "@/pages/prototype/auth/components/prototype-note";
import WireNote from "@/pages/prototype/auth/components/wire-note";
import {
  INVITE_TTL_DAYS,
  RESET_TTL_HOURS,
  WIRE,
} from "@/pages/prototype/auth/lib/mock-auth-api";
import type { DeadLinkState, GoTo } from "@/pages/prototype/auth/lib/scenarios";

type DeadLinkScreenProps = {
  state: DeadLinkState;
  onGo: GoTo;
};

export default function DeadLinkScreen({
  state,
  onGo,
}: DeadLinkScreenProps): ReactNode {
  const signIn = (
    <p>
      Already chose a password?{" "}
      <TextLink onClick={() => onGo("login")}>Sign in</TextLink>
    </p>
  );
  const needsPurposeNote = (
    <PrototypeNote kind="question">
      Only possible once the page knows which kind of link it was (the same API
      gap as on Set password).
    </PrototypeNote>
  );
  const wire = <WireNote exchange={WIRE.setDeadLink} />;

  const pages: Record<DeadLinkState, ReactNode> = {
    unknown: (
      <AuthPage
        icon={Link2Off}
        iconTone="warning"
        title="This link no longer works"
        body={`Each link works once, and expires: invites after ${INVITE_TTL_DAYS} days, password resets after ${RESET_TTL_HOURS} hours.`}
        footer={signIn}
        notes={wire}
      >
        <div className="flex flex-col gap-4">
          <Button variant="primary" isFullWidth onClick={() => onGo("forgot")}>
            Send me a new reset link
          </Button>
          <p className="text-center text-[14px] leading-5 text-(--tl-muted)">
            Came from an invite email? Ask an Admin to send you a new one.
          </p>
        </div>
      </AuthPage>
    ),
    invite: (
      <AuthPage
        icon={Link2Off}
        iconTone="warning"
        title="This invite has expired"
        body={`Invites work once, for ${INVITE_TTL_DAYS} days. Ask an Admin at M’s Helping Hands to send you a new one.`}
        footer={signIn}
        notes={
          <>
            {needsPurposeNote}
            {wire}
          </>
        }
      >
        <Button variant="outline" isFullWidth onClick={() => onGo("login")}>
          Go to sign in
        </Button>
      </AuthPage>
    ),
    reset: (
      <AuthPage
        icon={Link2Off}
        iconTone="warning"
        title="This reset link has expired"
        body={`Reset links work once, for ${RESET_TTL_HOURS} hours. Send yourself a new one.`}
        footer={
          <TextLink onClick={() => onGo("login")}>
            <ArrowLeft aria-hidden className="size-4" />
            Back to sign in
          </TextLink>
        }
        notes={
          <>
            {needsPurposeNote}
            {wire}
          </>
        }
      >
        <Button variant="primary" isFullWidth onClick={() => onGo("forgot")}>
          Send a new link
        </Button>
      </AuthPage>
    ),
  };
  return pages[state];
}
