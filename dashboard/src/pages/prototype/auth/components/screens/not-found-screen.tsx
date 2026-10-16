// Page not found. Today's NotFound is a bare <h1> for everyone; this
// gives it the brand frame.
import type { ReactNode } from "react";
import { Compass } from "lucide-react";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import AuthPage from "@/pages/prototype/auth/components/layout/auth-page";
import PrototypeNote from "@/pages/prototype/auth/components/prototype-note";
import type { GoTo } from "@/pages/prototype/auth/lib/scenarios";

type NotFoundScreenProps = { onGo: GoTo };

export default function NotFoundScreen({ onGo }: NotFoundScreenProps): ReactNode {
  return (
    <AuthPage
      icon={Compass}
      title="We can't find that page"
      body="The link may be old, or mistyped. Nothing is lost; start again from sign in."
      notes={
        <PrototypeNote kind="question">
          Signed-in Staff hit this page too. Should their 404 sit inside the
          app shell with &ldquo;Go to Home&rdquo; (or My sessions) instead?
        </PrototypeNote>
      }
    >
      <Button variant="primary" isFullWidth onClick={() => onGo("login")}>
        Go to sign in
      </Button>
    </AuthPage>
  );
}
