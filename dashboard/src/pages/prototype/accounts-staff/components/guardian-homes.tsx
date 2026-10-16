// The Guardian's Homes, managed here: add, edit, archive and restore.
// A shared Home (a couple living together) says who else it belongs to.
// A Home with upcoming Bookings can't be archived: the API answers 409,
// and the dashboard explains it.
import { useState } from "react";
import type { ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  MapPin,
  Pencil,
  Plus,
  Users,
} from "lucide-react";
import { EYEBROW } from "@/pages/prototype/shell-kit/kit/tokens";
import { Button, IconButton } from "@/pages/prototype/shell-kit/kit/components/button";
import { ConfirmDialog, Dialog } from "@/pages/prototype/shell-kit/kit/overlays/dialog";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";
import HomeFormSheet from "@/pages/prototype/accounts-staff/components/home-form-sheet";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import { countUpcomingAtHome } from "@/pages/prototype/accounts-staff/lib/mock-api";
import type { ClientRead, HomeRead } from "@/pages/prototype/accounts-staff/types/api";

type Editing = { home: HomeRead | null };

type GuardianHomesProps = { guardian: ClientRead };

export default function GuardianHomes({ guardian }: GuardianHomesProps): ReactNode {
  const { db, addHome, updateHome, setHomeArchived } = useArea();
  const { showToast } = useToast();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [archiving, setArchiving] = useState<HomeRead | null>(null);
  const [blocked, setBlocked] = useState<{ home: HomeRead; count: number } | null>(null);
  const active = guardian.homes.filter((home) => !home.archived);
  const archived = guardian.homes.filter((home) => home.archived);
  const canManage = !guardian.archived;

  function handleArchive(home: HomeRead): void {
    setArchiving(null);
    if (!setHomeArchived(home.id, true)) {
      setBlocked({ home, count: countUpcomingAtHome(db, home.id) });
      return;
    }
    showToast({
      tone: "success",
      message: "Home archived. It can’t be picked for new Bookings.",
      actionLabel: "Undo",
      onAction: () => setHomeArchived(home.id, false),
    });
  }

  function getSharedWith(home: HomeRead): string {
    return home.guardians.filter((g) => g.id !== guardian.id).map((g) => g.name).join(", ");
  }

  return (
    <>
      <div className="mt-8 mb-3 flex items-center justify-between gap-3">
        <h3 className={EYEBROW}>Homes · {active.length}</h3>
        {canManage && (
          <Button variant="soft" icon={Plus} onClick={() => setEditing({ home: null })}>
            Add home
          </Button>
        )}
      </div>
      {active.length === 0 ? (
        <p className="rounded-[16px] bg-(--tl-surface-sunk) px-4 py-3 text-[14px] text-(--tl-muted)">
          No Homes yet. Bookings can still be In office.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {active.map((home) => {
            const sharedWith = getSharedWith(home);
            return (
              <li key={home.id} className="flex items-start gap-3 rounded-[18px] border border-(--tl-border) bg-(--tl-surface) py-2 pr-1 pl-4">
                <MapPin aria-hidden className="mt-3 size-4 shrink-0 text-(--tl-muted)" />
                <span className="min-w-0 flex-1 py-2">
                  {home.label && <span className="block text-[13px] font-semibold text-(--tl-ink-soft)">{home.label}</span>}
                  <span className="block text-[14px] leading-5 font-semibold">{home.address}</span>
                  {home.directions && (
                    <span className="mt-0.5 block text-[13px] leading-[18px] text-(--tl-muted)">{home.directions}</span>
                  )}
                  {sharedWith && (
                    <span className="mt-1 flex items-center gap-1.5 text-[13px] text-(--tl-ink-soft)">
                      <Users aria-hidden className="size-3.5" />
                      Shared with {sharedWith}
                    </span>
                  )}
                </span>
                {canManage && (
                  <>
                    <IconButton icon={Pencil} label={`Edit ${home.address}`} onClick={() => setEditing({ home })} />
                    <IconButton icon={Archive} label={`Archive ${home.address}`} onClick={() => setArchiving(home)} />
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {archived.length > 0 && (
        <details className="group mt-3">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full px-1 text-[14px] font-semibold text-(--tl-link) [&::-webkit-details-marker]:hidden">
            <ChevronDown aria-hidden className="size-4 transition-transform duration-150 group-open:rotate-180" />
            Archived · {archived.length}
          </summary>
          <ul className="mt-1 flex flex-col gap-2">
            {archived.map((home) => (
              <li key={home.id} className="flex items-center gap-3 rounded-[18px] bg-(--tl-surface-sunk) py-2 pr-2 pl-4 text-(--tl-muted)">
                <span className="min-w-0 flex-1 text-[14px] leading-5">{home.address}</span>
                {canManage && (
                  <Button
                    icon={ArchiveRestore}
                    onClick={() => {
                      setHomeArchived(home.id, false);
                      showToast({ tone: "success", message: "Home restored." });
                    }}
                  >
                    Restore
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {editing && (
        <HomeFormSheet
          home={editing.home}
          guardianName={guardian.name}
          onClose={() => setEditing(null)}
          onSave={(input) => {
            if (editing.home) updateHome(editing.home.id, input);
            else addHome([guardian.id], input);
            setEditing(null);
            showToast({ tone: "success", message: editing.home ? "Home saved." : "Home added." });
          }}
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
        {archiving?.address} can’t be picked as a Location for new Bookings
        {archiving && getSharedWith(archiving) ? `, for ${getSharedWith(archiving)} too` : ""}. Past
        Bookings keep it. You can Restore it from Archived.
      </ConfirmDialog>
      <Dialog
        isOpen={blocked !== null}
        onClose={() => setBlocked(null)}
        title="This Home still has Bookings"
        footer={<Button variant="primary" onClick={() => setBlocked(null)}>Got it</Button>}
      >
        {blocked?.count} upcoming {blocked?.count === 1 ? "Booking is" : "Bookings are"} at {blocked?.home.address}.
        Change {blocked?.count === 1 ? "it" : "them"} to another Location in Bookings first, then archive the Home.
      </Dialog>
    </>
  );
}
