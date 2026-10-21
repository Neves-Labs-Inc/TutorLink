// What shows while the session is checked: the kit splash on the user's
// theme, so a reload never flashes a blank page.
import type { ReactNode } from "react";
import SplashScreen from "@/components/kit/auth/splash-screen";
import KitRoot from "@/components/kit/kit-root";
import { useTheme } from "@/hooks/use-theme";

export default function SessionSplash(): ReactNode {
  const { theme } = useTheme();
  return (
    <KitRoot theme={theme}>
      <SplashScreen />
    </KitRoot>
  );
}
