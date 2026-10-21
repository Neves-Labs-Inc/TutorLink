// The role's welcome card, placed straight under a landing page's
// PageHeader. Shown until the person dismisses it once; renders nothing
// while the profile loads, if it fails, or once the welcome is seen, so
// most visits never reserve space for it.
import { useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { WelcomeCard } from "@/components/kit/components/welcome-card";
import { WELCOME_COPY } from "@/components/layout/landing-welcome-copy";
import { markWelcomeSeen, meQueries } from "@/lib/queries/me";
import type { Me } from "@/lib/queries/me";
import { useAuthStore } from "@/stores/authStore";

export function LandingWelcome(): ReactNode {
  const role = useAuthStore((state) => state.role);
  const queryClient = useQueryClient();
  const me = useQuery(meQueries.detail());
  // Local to this mount: a failed POST leaves the cache alone, so the
  // card comes back on the next load (Franklin 2026-10-20). Once
  // dismissed, the card stays mounted to play its fade (it renders
  // nothing after), whatever the cache does meanwhile.
  const [isDismissed, setIsDismissed] = useState(false);
  const markSeen = useMutation({
    mutationFn: markWelcomeSeen,
    onSuccess: async () => {
      const { queryKey } = meQueries.detail();
      // Cancel first so a GET already in flight can't land after and bring the card back.
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<Me>(queryKey, (current) =>
        current ? { ...current, welcome_seen: true } : current,
      );
    },
  });

  function handleDismiss(): void {
    setIsDismissed(true);
    markSeen.mutate();
  }

  const isUnseen = !me.isError && me.data?.welcome_seen === false;
  if (role === null || !(isDismissed || isUnseen)) return null;

  const { title, body } = WELCOME_COPY[role];
  return <WelcomeCard title={title} body={body} onDismiss={handleDismiss} />;
}
