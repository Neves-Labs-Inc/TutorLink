// screen=inputs: every field type with label, help text and an error.
import { useState } from "react";
import type { ReactNode } from "react";
import { Mail } from "lucide-react";
import { STAFF } from "@/pages/prototype/shell-kit/kit/mock-data";
import {
  SearchInput,
  SelectField,
  TextAreaField,
  TextField,
} from "@/pages/prototype/shell-kit/kit/components/fields";
import {
  CheckboxField,
  RadioCards,
  SwitchField,
} from "@/pages/prototype/shell-kit/kit/components/choices";
import Select from "@/pages/prototype/shell-kit/kit/components/select";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import { BottomSheet } from "@/pages/prototype/shell-kit/kit/overlays/bottom-sheet";
import { MultiSelectFilter } from "@/pages/prototype/shell-kit/kit/components/multi-select-filter";
import { Combobox } from "@/pages/prototype/shell-kit/kit/components/combobox";
import { SegmentedControl } from "@/pages/prototype/shell-kit/kit/components/tabs";
import { Gallery, Specimen } from "@/pages/prototype/shell-kit/screens/gallery";

const SUBJECT_OPTIONS = [
  { value: "math", label: "Math" },
  { value: "reading", label: "Reading" },
  { value: "writing", label: "Writing" },
  { value: "science", label: "Science" },
];

const BUSINESS_TYPE_OPTIONS = [
  { value: "tutoring", label: "Tutoring center" },
  { value: "solo", label: "Solo tutor" },
];

const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "pt", label: "Portuguese" },
];

const STAFF_OPTIONS = STAFF.filter((staff) => !staff.isArchived).map(
  (staff) => ({
    value: staff.id,
    label: staff.name,
    description: `${staff.role} · ${staff.subjects.join(", ")}`,
    hasAvatar: true,
  }),
);

const LOCATION_OPTIONS = [
  { value: "home", label: "Home visits", description: "The Child’s home only" },
  { value: "either", label: "Home or office", description: "Either works" },
  { value: "office", label: "Office only", description: "In office, no address" },
];

export default function InputsScreen(): ReactNode {
  const [email, setEmail] = useState("priya.p@gmail");
  const [query, setQuery] = useState("");
  const [staffId, setStaffId] = useState<string | null>("s3");
  const [isOn, setIsOn] = useState(true);
  const [isChecked, setIsChecked] = useState(true);
  const [location, setLocation] = useState("either");
  const [kind, setKind] = useState("tutoring");
  const [statuses, setStatuses] = useState<string[]>(["Pending"]);
  const [language, setLanguage] = useState("en");
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const isEmailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);

  return (
    <Gallery
      title="Inputs"
      intro="Labels always sit above the field (placeholders are hints, never labels). Help text sits below; an error replaces it, turns the outline red and says how to fix it."
    >
      <Specimen title="Text">
        <div className="grid gap-6 @3xl:grid-cols-2">
          <TextField
            label="Display name"
            defaultValue="Maria"
            help="Guardians see this when you take over a chat."
          />
          <TextField
            label="Email"
            type="email"
            icon={Mail}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={isEmailValid ? undefined : "Enter a full email, like name@example.com."}
            required
          />
          <TextField label="Phone" type="tel" placeholder="+1 305 555 0100" />
          <TextField label="Business name" defaultValue="M’s Helping Hands" disabled help="Only Admins can change this." />
        </div>
      </Specimen>
      <Specimen title="Textarea">
        <TextAreaField
          label="Child notes"
          defaultValue="Gets anxious with fractions; likes drawing."
          help="Tutors see these with every Session."
        />
      </Specimen>
      <Specimen title="Select, combobox and search" note="Kit select for short fixed lists; the combobox for long lists you search (Staff, Children).">
        <div className="grid gap-6 @3xl:grid-cols-2">
          <SelectField label="Subject" options={SUBJECT_OPTIONS} placeholder="Pick a subject" required />
          <SelectField label="Subject" options={SUBJECT_OPTIONS} defaultValue="reading" />
          <SelectField label="Subject" options={SUBJECT_OPTIONS} placeholder="Pick a subject" required error="Pick a subject." />
          <SelectField
            label="Business type"
            options={BUSINESS_TYPE_OPTIONS}
            defaultValue="tutoring"
            disabled
            help="Only Admins can change this."
          />
          <SelectField
            label="Room"
            options={[]}
            placeholder="Pick a room"
            help="No rooms set up yet."
          />
          <p className="flex items-center text-[15px] text-(--tl-ink-soft)">
            Guardian language ·&nbsp;
            <Select
              variant="inline"
              aria-label="Guardian language"
              label="Guardian language"
              options={LANGUAGE_OPTIONS}
              value={language}
              onValueChange={setLanguage}
            />
          </p>
          <div className="flex items-end">
            <Button variant="soft" onClick={() => setIsSheetOpen(true)}>
              Open in a sheet
            </Button>
          </div>
          <Combobox
            label="Staff"
            options={STAFF_OPTIONS}
            value={staffId}
            onChange={setStaffId}
            placeholder="Search Staff"
            help="Only Staff who teach this subject level."
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-[14px] leading-5 font-semibold">Search (label hidden)</span>
            <SearchInput
              label="Search bookings"
              placeholder="Search a Child or Staff"
              value={query}
              onChange={setQuery}
            />
          </div>
        </div>
        <BottomSheet
          isOpen={isSheetOpen}
          onClose={() => setIsSheetOpen(false)}
          title="Edit Booking"
        >
          <SelectField label="Subject" options={SUBJECT_OPTIONS} defaultValue="math" />
        </BottomSheet>
      </Specimen>
      <Specimen title="Date and time" note="Native pickers; they follow light and dark through color-scheme.">
        <div className="grid gap-6 @md:grid-cols-3">
          <TextField label="Date" type="date" defaultValue="2026-10-15" />
          <TextField label="Starts" type="time" defaultValue="15:30" />
          <TextField label="Ends" type="time" defaultValue="15:00" error="Ends before it starts. Pick a later time." />
        </div>
      </Specimen>
      <Specimen title="Switch, checkbox, radio cards">
        <div className="grid gap-8 @3xl:grid-cols-2">
          <div className="flex flex-col gap-3">
            <SwitchField
              label="Booking reminders"
              description="Weekly message to Guardians with nothing booked."
              isOn={isOn}
              onChange={setIsOn}
            />
            <SwitchField label="Disabled switch" isOn={false} onChange={() => undefined} isDisabled />
            <CheckboxField
              label="Tell the Guardian in chat"
              description="Sends the change as a message from the office."
              isChecked={isChecked}
              onChange={setIsChecked}
            />
          </div>
          <RadioCards
            legend="Where can this slot be booked?"
            options={LOCATION_OPTIONS}
            value={location}
            onChange={setLocation}
          />
        </div>
      </Specimen>
      <Specimen title="Segmented control and filter dropdown" note="Segmented switches a view of the same data. Filters are one multi-select dropdown per field; the trigger counts what's on.">
        <div className="flex flex-wrap items-center gap-4">
          <SegmentedControl
            label="Booking kind"
            activeId={kind}
            onChange={setKind}
            items={[
              { id: "tutoring", label: "Tutoring" },
              { id: "evaluation", label: "Evaluation" },
            ]}
          />
          <MultiSelectFilter
            label="Status"
            options={[
              { value: "Pending", label: "Pending", count: 3 },
              { value: "Confirmed", label: "Confirmed", count: 9 },
              { value: "Completed", label: "Completed", count: 1 },
              { value: "Cancelled", label: "Cancelled", count: 1 },
            ]}
            selected={statuses}
            onChange={setStatuses}
          />
        </div>
      </Specimen>
    </Gallery>
  );
}
