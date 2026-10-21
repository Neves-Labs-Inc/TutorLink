// The catch-all route. What it shows depends on who is asking: the
// splash while the session is checked, the signed-in shell around a
// not-found card, or the brand frame for a signed-out visitor.
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Compass } from "lucide-react";
import { AuthFrame } from "@/components/kit/auth/auth-frame";
import { Button } from "@/components/kit/components/button";
import KitRoot from "@/components/kit/kit-root";
import { PageHeader } from "@/components/kit/shell/page-header";
import { EmptyState } from "@/components/kit/states/states";
import AppLayout from "@/components/layout/app-layout";
import SessionSplash from "@/components/layout/session-splash";
import { useTheme } from "@/hooks/use-theme";
import { isOfficeRole, landingPath } from "@/lib/auth/auth";
import type { Role } from "@/lib/auth/auth";
import { useAuthStore } from "@/stores/authStore";

const LOGIN_PATH = "/login";
const TITLE = "We can’t find that page";
const LINK_HINT = "The link may be old, or mistyped.";

type SignedInNotFoundProps = { role: Role };

function SignedInNotFound({ role }: SignedInNotFoundProps): ReactNode {
  const navigate = useNavigate();
  const label = isOfficeRole(role) ? "Go to Home" : "Go to My sessions";
  return (
    <>
      <PageHeader title="Page not found" />
      <EmptyState
        icon={Compass}
        tone="primary"
        title={TITLE}
        body={LINK_HINT}
        action={
          <Button variant="primary" onClick={() => navigate(landingPath(role))}>
            {label}
          </Button>
        }
      />
    </>
  );
}

function SignedOutNotFound(): ReactNode {
  const navigate = useNavigate();
  const { theme } = useTheme();
  return (
    <KitRoot theme={theme}>
      <AuthFrame
        icon={Compass}
        tone="primary"
        title={TITLE}
        body={`${LINK_HINT} Nothing is lost; start again from sign in.`}
      >
        <Button variant="primary" isFullWidth onClick={() => navigate(LOGIN_PATH)}>
          Go to sign in
        </Button>
      </AuthFrame>
    </KitRoot>
  );
}

export default function NotFoundPage(): ReactNode {
  const status = useAuthStore((state) => state.status);
  const role = useAuthStore((state) => state.role);

  if (status === "loading") return <SessionSplash />;
  if (role === null) return <SignedOutNotFound />;
  return (
    <AppLayout>
      <SignedInNotFound role={role} />
    </AppLayout>
  );
}
