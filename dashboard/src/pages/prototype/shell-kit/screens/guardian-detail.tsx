// Guardian details: contact, Guardian language, Booking reminders, their
// Children (each opens the Child's profile), Open chat, and their Homes,
// managed here: add, edit, archive (with confirm) and restore.
import { useState } from "react";
import type { ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  BellRing,
  ChevronDown,
  ChevronRight,
  Languages,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
} from "lucide-react";
import {
  CHILDREN,
  formatAddress,
} from "@/pages/prototype/shell-kit/kit/mock-data";
import type { Child, Guardian, Home } from "@/pages/prototype/shell-kit/kit/mock-data";
import { CARD, cn, EYEBROW } from "@/pages/prototype/shell-kit/kit/tokens";
import {
  Avatar,
  EvaluatedBadge,
  RemindersBadge,
} from "@/pages/prototype/shell-kit/kit/components/badges";
import { Button, IconButton } from "@/pages/prototype/shell-kit/kit/components/button";
import { DetailRow } from "@/pages/prototype/shell-kit/kit/components/detail";
import { DetailOverlay } from "@/pages/prototype/shell-kit/kit/overlays/detail-overlay";
import { ConfirmDialog } from "@/pages/prototype/shell-kit/kit/overlays/dialog";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";
import HomeFormSheet from "@/pages/prototype/shell-kit/screens/home-form-sheet";
import { useHomes } from "@/pages/prototype/shell-kit/screens/use-homes";

function getBlankHome(guardianId: string): Home {
  return {
    id: `home-${Date.now()}`,
    guardianId,
    street: "",
    unit: "",
    city: "Doral",
    state: "FL",
    zip: "",
    directions: "",
    isArchived: false,
  };
}

type GuardianDetailProps = {
  guardian: Guardian;
  backLabel: string;
  onBack: () => void;
  onClose: () => void;
  onOpenChild: (child: Child) => void;
};

export default function GuardianDetail({
  guardian,
  backLabel,
  onBack,
  onClose,
  onOpenChild,
}: GuardianDetailProps): ReactNode {
  const { homes, saveHome, setArchived } = useHomes();
  const [editing, setEditing] = useState<Home | null>(null);
  const [archiving, setArchiving] = useState<Home | null>(null);
  const { showToast } = useToast();
  const children = CHILDREN.filter((child) => guardian.children.includes(child.name));
  const ownHomes = homes.filter((home) => home.guardianId === guardian.id);
  const activeHomes = ownHomes.filter((home) => !home.isArchived);
  const archivedHomes = ownHomes.filter((home) => home.isArchived);

  function handleSave(home: Home): void {
    const isNew = !homes.some((item) => item.id === home.id);
    saveHome(home);
    setEditing(null);
    showToast({ tone: "success", message: isNew ? "Home added." : "Home saved." });
  }

  function handleArchive(home: Home): void {
    setArchived(home.id, true);
    setArchiving(null);
    showToast({
      tone: "success",
      message: "Home archived. It can’t be picked for new Bookings.",
      actionLabel: "Undo",
      onAction: () => setArchived(home.id, false),
    });
  }

  function handleRestore(home: Home): void {
    setArchived(home.id, false);
    showToast({ tone: "success", message: "Home restored." });
  }

  return (
    <>
      <DetailOverlay
        isOpen
        onClose={onClose}
        onBack={onBack}
        title={`Guardian: ${guardian.name}`}
        backLabel={backLabel}
        phoneMode="page"
        header={<RemindersBadge state={guardian.reminders} />}
        footer={
          <Button variant="primary" icon={MessageCircle} isFullWidth>
            Open chat
          </Button>
        }
      >
        <div className="flex items-center gap-4">
          <Avatar name={guardian.name} size="lg" />
          <h2 className="kit-display min-w-0 truncate text-[28px] leading-9 font-light">
            {guardian.name}
          </h2>
        </div>
        <div className="mt-6 flex flex-col gap-5">
          <DetailRow icon={Phone} label="Phone (WhatsApp)">
            <p className="font-semibold tabular-nums">{guardian.phone}</p>
          </DetailRow>
          <DetailRow icon={Languages} label="Guardian language">
            <p className="font-semibold">{guardian.language}</p>
          </DetailRow>
          <DetailRow icon={BellRing} label="Booking reminders">
            <p className="font-semibold">{guardian.reminders}</p>
          </DetailRow>
        </div>

        <h3 className={cn(EYEBROW, "mt-8 mb-3")}>
          {children.length === 1 ? "Child" : `Children · ${children.length}`}
        </h3>
        <ul className="flex flex-col gap-2">
          {children.map((child) => (
            <li key={child.id}>
              <button
                type="button"
                onClick={() => onOpenChild(child)}
                aria-label={`Open ${child.name}`}
                className={cn(
                  CARD,
                  "flex min-h-[64px] w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:border-(--tl-hero)",
                )}
              >
                <Avatar name={child.name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{child.name}</span>
                  <span className="block text-[13px] text-(--tl-muted)">{child.overallGrade}</span>
                </span>
                <EvaluatedBadge isEvaluated={child.isEvaluated} />
                <ChevronRight aria-hidden className="size-5 shrink-0 text-(--tl-muted)" />
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-8 mb-3 flex items-center justify-between gap-3">
          <h3 className={EYEBROW}>Homes · {activeHomes.length}</h3>
          <Button
            variant="soft"
            icon={Plus}
            onClick={() => setEditing(getBlankHome(guardian.id))}
          >
            Add home
          </Button>
        </div>
        {activeHomes.length === 0 ? (
          <p className="rounded-[16px] bg-(--tl-surface-sunk) px-4 py-3 text-[14px] text-(--tl-muted)">
            No Homes yet. Bookings can still be In office.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {activeHomes.map((home) => (
              <li
                key={home.id}
                className="flex items-start gap-3 rounded-[18px] border border-(--tl-border) bg-(--tl-surface) py-2 pr-1 pl-4"
              >
                <MapPin aria-hidden className="mt-3 size-4 shrink-0 text-(--tl-muted)" />
                <span className="min-w-0 flex-1 py-2">
                  <span className="block text-[14px] leading-5 font-semibold">
                    {formatAddress(home)}
                  </span>
                  {home.directions && (
                    <span className="mt-0.5 block text-[13px] leading-[18px] text-(--tl-muted)">
                      {home.directions}
                    </span>
                  )}
                </span>
                <IconButton
                  icon={Pencil}
                  label={`Edit ${home.street}`}
                  onClick={() => setEditing(home)}
                />
                <IconButton
                  icon={Archive}
                  label={`Archive ${home.street}`}
                  onClick={() => setArchiving(home)}
                />
              </li>
            ))}
          </ul>
        )}
        {archivedHomes.length > 0 && (
          <details className="group mt-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full px-1 text-[14px] font-semibold text-(--tl-link) [&::-webkit-details-marker]:hidden">
              <ChevronDown
                aria-hidden
                className="size-4 transition-transform duration-150 group-open:rotate-180"
              />
              Archived · {archivedHomes.length}
            </summary>
            <ul className="mt-1 flex flex-col gap-2">
              {archivedHomes.map((home) => (
                <li
                  key={home.id}
                  className="flex items-center gap-3 rounded-[18px] bg-(--tl-surface-sunk) py-2 pr-2 pl-4 text-(--tl-muted)"
                >
                  <span className="min-w-0 flex-1 text-[14px] leading-5">
                    {formatAddress(home)}
                  </span>
                  <Button icon={ArchiveRestore} onClick={() => handleRestore(home)}>
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </DetailOverlay>
      {editing && (
        <HomeFormSheet
          key={editing.id}
          home={editing}
          guardianName={guardian.name}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
      <ConfirmDialog
        isOpen={archiving !== null}
        onClose={() => setArchiving(null)}
        onConfirm={() => archiving && handleArchive(archiving)}
        title="Archive this Home?"
        confirmLabel="Archive home"
        keepLabel="Keep home"
        isDestructive
      >
        {archiving ? formatAddress(archiving) : ""} can’t be picked as a
        Location for new Bookings. Past Bookings keep it. You can Restore it
        from Archived.
      </ConfirmDialog>
    </>
  );
}
