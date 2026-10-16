// Stands in for any page outside Home's prototype (another nav item, an
// opened chat), so taps from Home have somewhere visible to land.
import type { ReactNode } from "react";
import { ArrowLeft, Compass } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import { PageHeader } from "@/components/kit/shell/page-header";
import { EmptyState } from "@/components/kit/states/states";

export type Elsewhere = { title: string; body: string };

type ElsewhereScreenProps = { place: Elsewhere; onBackHome: () => void };

export default function ElsewhereScreen({
  place,
  onBackHome,
}: ElsewhereScreenProps): ReactNode {
  return (
    <>
      <PageHeader title={place.title} />
      <EmptyState
        icon={Compass}
        title="Designed in another prototype"
        body={place.body}
        action={
          <Button variant="primary" icon={ArrowLeft} onClick={onBackHome}>
            Back to Home
          </Button>
        }
      />
    </>
  );
}
