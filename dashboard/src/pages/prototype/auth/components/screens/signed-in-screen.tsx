// Stand-in for where a successful submit leads. In the app it's a
// redirect into the shell, designed in the Home and My sessions
// prototypes.
import type { ReactNode } from "react";
import { CircleCheck } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import AuthPage from "@/pages/prototype/auth/components/layout/auth-page";
import PrototypeNote from "@/pages/prototype/auth/components/prototype-note";
import type { SignedInFrom } from "@/pages/prototype/auth/lib/scenarios";

const FROM_LABEL: Record<SignedInFrom, string> = {
  login: "Signed in",
  invite: "Password set, and signed in",
  reset: "New password saved, and signed in",
};

type SignedInScreenProps = {
  from: SignedInFrom;
  onRestart: () => void;
};

export default function SignedInScreen({
  from,
  onRestart,
}: SignedInScreenProps): ReactNode {
  return (
    <AuthPage
      icon={CircleCheck}
      iconTone="success"
      title={FROM_LABEL[from]}
      body="Admins and Managers land on Home; Tutors land on My sessions."
      notes={
        <PrototypeNote>
          In the app this is a redirect, not a page. Home and My sessions are
          designed in their own prototypes.
        </PrototypeNote>
      }
    >
      <Button variant="outline" isFullWidth onClick={onRestart}>
        Back to this screen
      </Button>
    </AuthPage>
  );
}
