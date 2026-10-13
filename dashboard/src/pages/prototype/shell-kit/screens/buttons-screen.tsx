// screen=buttons: every button variant and state.
import { useState } from "react";
import type { ReactNode } from "react";
import {
  Check,
  Ellipsis,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { Button, IconButton, TextLink } from "@/pages/prototype/shell-kit/kit/components/button";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";
import { Gallery, Specimen } from "@/pages/prototype/shell-kit/screens/gallery";

const FAKE_SAVE_MS = 1200;

export default function ButtonsScreen(): ReactNode {
  const [isSaving, setIsSaving] = useState(false);
  const { showToast } = useToast();

  function handleSave(): void {
    setIsSaving(true);
    window.setTimeout(() => {
      setIsSaving(false);
      showToast({ tone: "success", message: "Changes saved." });
    }, FAKE_SAVE_MS);
  }

  return (
    <Gallery
      title="Buttons"
      intro="Every button is a 44px pill, so the tap target never shrinks. One primary per view. Labels say the act (“Cancel booking”, never “OK”)."
    >
      <Specimen
        title="Variants"
        note="Primary for the one main act; Soft for a positive secondary (Approve); Outline for neutral; Ghost for low-weight; Danger only inside a confirm."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" icon={Plus}>
            New booking
          </Button>
          <Button variant="soft" icon={Check}>
            Approve
          </Button>
          <Button icon={X}>Decline</Button>
          <Button variant="ghost">Clear all</Button>
          <Button variant="danger-outline">Cancel booking</Button>
          <Button variant="danger" icon={Trash2}>
            Archive
          </Button>
        </div>
      </Specimen>
      <Specimen title="States" note="Click Save to see the loading state.">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            icon={Save}
            isLoading={isSaving}
            onClick={handleSave}
          >
            {isSaving ? "Saving…" : "Save changes"}
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button disabled>Disabled</Button>
        </div>
      </Specimen>
      <Specimen
        title="Icon buttons"
        note="44px circles with a name for screen readers and a tooltip."
      >
        <div className="flex flex-wrap items-center gap-3">
          <IconButton icon={Pencil} label="Change" />
          <IconButton icon={Ellipsis} label="More actions" variant="outline" />
          <IconButton icon={Plus} label="New booking" variant="primary" />
        </div>
      </Specimen>
      <Specimen title="Inline links">
        <p className="text-[15px] leading-6">
          Laura Martinez asked to move Thursday.{" "}
          <TextLink>Open chat</TextLink>
        </p>
      </Specimen>
      <Specimen title="Pairs and full width" note="Phones stack actions full width, primary on top.">
        <div className="flex max-w-[420px] flex-col gap-2">
          <Button variant="primary" isFullWidth>
            Change booking
          </Button>
          <Button variant="danger-outline" isFullWidth>
            Cancel booking
          </Button>
        </div>
      </Specimen>
    </Gallery>
  );
}
