// Every auth screen renders in the brand panel frame (variant B, picked
// by Franklin for #198).
import type { ReactNode } from "react";
import SplitLayout from "@/pages/prototype/auth/components/layout/split-layout";
import type { AuthPageContent } from "@/pages/prototype/auth/lib/auth-page-content";

export default function AuthPage(content: AuthPageContent): ReactNode {
  return <SplitLayout {...content} />;
}
