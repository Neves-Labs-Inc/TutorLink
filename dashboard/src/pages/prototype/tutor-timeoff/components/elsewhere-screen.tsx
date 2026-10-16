// Stand-in for nav items designed in other area prototypes, so the
// shell can be clicked through without leaving this one.
import type { ReactNode } from "react";
import { Compass } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import { PageHeader } from "@/components/kit/shell/page-header";
import { EmptyState } from "@/components/kit/states/states";

export type Elsewhere = { title: string; body: string };

type ElsewhereScreenProps = { place: Elsewhere; onBack: () => void };

export default function ElsewhereScreen({ place, onBack }: ElsewhereScreenProps): ReactNode {
  return (
    <>
      <PageHeader title={place.title} />
      <EmptyState
        icon={Compass}
        title="Designed in another prototype"
        body={place.body}
        action={<Button onClick={onBack}>Back</Button>}
      />
    </>
  );
}
