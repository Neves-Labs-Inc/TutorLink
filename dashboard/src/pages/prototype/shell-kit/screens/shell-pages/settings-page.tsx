// Settings (Admins only): grouped cards of real inputs, saved with one
// primary action. Grouping is a placeholder; the Settings prototype
// decides it.
import { useState } from "react";
import type { ReactNode } from "react";
import { Save } from "lucide-react";
import { CARD, cn, HEADING } from "@/pages/prototype/shell-kit/kit/tokens";
import {
  SelectField,
  TextField,
} from "@/pages/prototype/shell-kit/kit/components/fields";
import { SwitchField } from "@/pages/prototype/shell-kit/kit/components/choices";
import { PageHeader } from "@/pages/prototype/shell-kit/kit/shell/page-header";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";

const DAYS = ["Friday", "Saturday", "Sunday"].map((day) => ({
  value: day,
  label: day,
}));

type SectionProps = { title: string; description: string; children: ReactNode };

function Section({ title, description, children }: SectionProps): ReactNode {
  return (
    <section
      className={cn(
        CARD,
        "grid gap-5 p-5 @2xl:p-6 @5xl:grid-cols-[280px_minmax(0,1fr)] @5xl:gap-10",
      )}
    >
      <div>
        <h2 className={HEADING}>{title}</h2>
        <p className="mt-1 text-[14px] leading-5 text-(--tl-muted)">
          {description}
        </p>
      </div>
      <div className="flex max-w-[560px] flex-col gap-5">{children}</div>
    </section>
  );
}

export default function SettingsPage(): ReactNode {
  const [businessName, setBusinessName] = useState("M’s Helping Hands");
  const [areRemindersOn, setAreRemindersOn] = useState(true);
  const [reminderDay, setReminderDay] = useState("Sunday");
  const { showToast } = useToast();

  return (
    <>
      <PageHeader
        title="Settings"
        description="How TutorLink runs for the whole office."
        primaryAction={{
          label: "Save changes",
          icon: Save,
          onClick: () => showToast({ tone: "success", message: "Settings saved." }),
        }}
      />
      <div className="flex flex-col gap-6">
        <Section
          title="Business"
          description="Shown to Guardians in the bot and in Booking reminders."
        >
          <TextField
            label="Business name"
            value={businessName}
            onChange={(event) => setBusinessName(event.target.value)}
            required
          />
          <TextField
            label="Time zone"
            value="Eastern Time (Doral, FL)"
            help="Bookings and reminders all use this time."
            disabled
          />
        </Section>
        <Section
          title="Booking reminders"
          description="A weekly message to Guardians with no session booked in the coming week."
        >
          <SwitchField
            label="Send Booking reminders"
            description="Guardians who chose Reminders off never get one."
            isOn={areRemindersOn}
            onChange={setAreRemindersOn}
          />
          <div className="grid gap-5 @md:grid-cols-2">
            <SelectField
              label="Day"
              options={DAYS}
              value={reminderDay}
              onChange={(event) => setReminderDay(event.target.value)}
              disabled={!areRemindersOn}
            />
            <TextField
              label="Time"
              type="time"
              defaultValue="17:00"
              disabled={!areRemindersOn}
            />
          </div>
        </Section>
      </div>
    </>
  );
}
