// My availability (Tutor): the whole week read-only, one Edit for all.
import { useState } from "react";
import type { ReactNode } from "react";
import { AVAILABILITY } from "@/pages/prototype/shell-kit/kit/mock-data";
import { AvailabilityEditor } from "@/pages/prototype/shell-kit/kit/components/availability-editor";
import { PageHeader } from "@/pages/prototype/shell-kit/kit/shell/page-header";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";

export default function MyAvailabilityPage(): ReactNode {
  const [slots, setSlots] = useState(AVAILABILITY);
  const { showToast } = useToast();
  return (
    <>
      <PageHeader
        title="My availability"
        description="When and where Guardians can book you through the bot."
      />
      <AvailabilityEditor
        slots={slots}
        onSave={(next) => {
          setSlots(next);
          showToast({ tone: "success", message: "Availability saved." });
        }}
      />
    </>
  );
}
