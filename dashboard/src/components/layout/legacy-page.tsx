// An old screen inside the kit shell: the kit <main> owns gutters and
// width; this only gives old headings PageHeader's top spacing. Each area
// drops it when its screens are rebuilt.
import type { ReactNode } from "react";

type LegacyPageProps = {
  children: ReactNode;
};

export default function LegacyPage({ children }: LegacyPageProps): ReactNode {
  return <div className="pt-5 @5xl:pt-6">{children}</div>;
}
