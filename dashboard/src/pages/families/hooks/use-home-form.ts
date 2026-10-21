// The Add home / Edit home sheet's state. Add posts the Home with its
// owners; Edit saves only what changed, then shares and unshares. When
// an unshare is refused, what did save stays saved: the sheet keeps
// those values as its new starting point and ticks the server's owners.
import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/components/kit/overlays/use-toast";
import { bookingIdsOf } from "@/lib/api";
import { familyMutations } from "@/lib/queries/families";
import { HomeSaveError, homeSaveMutations } from "@/lib/queries/home-save";
import type { HomeUpdate, HouseholdHome, NamedRef } from "@/types/families";

const ADDRESS_MISSING = "Enter the full address.";
const OWNER_MISSING = "Pick at least one Guardian.";
const SAVE_FAILED = "Couldn’t save the Home. Check your connection and try again.";

type HomeFields = { address: string; label: string; directions: string };

type HomeDraft = HomeFields & { ownerIds: string[] };

export type HomeErrors = { address: string | null; owners: string | null };

const NO_ERRORS: HomeErrors = { address: null, owners: null };

function getStartingDraft(
  home: HouseholdHome | null,
  liveGuardianIds: string[],
): HomeDraft {
  if (!home) {
    return { address: "", label: "", directions: "", ownerIds: liveGuardianIds };
  }
  return {
    address: home.address,
    label: home.label ?? "",
    directions: home.directions ?? "",
    // Archived owners aren't offered, so they stay as they are.
    ownerIds: home.guardian_ids.filter((id) => liveGuardianIds.includes(id)),
  };
}

// Blank label and directions are null on the wire.
function toWire(fields: HomeFields): Required<HomeUpdate> {
  return {
    address: fields.address.trim(),
    label: fields.label.trim() || null,
    directions: fields.directions.trim() || null,
  };
}

function getChanges(saved: HomeFields, draft: HomeFields): HomeUpdate {
  const before = toWire(saved);
  const after = toWire(draft);
  // On a PATCH null leaves a field alone on the server; "" clears it.
  return {
    ...(after.address !== before.address && { address: after.address }),
    ...(after.label !== before.label && { label: after.label ?? "" }),
    ...(after.directions !== before.directions && {
      directions: after.directions ?? "",
    }),
  };
}

function getErrors(draft: HomeDraft, mustPickOwner: boolean): HomeErrors {
  return {
    address: draft.address.trim() ? null : ADDRESS_MISSING,
    owners: mustPickOwner && draft.ownerIds.length === 0 ? OWNER_MISSING : null,
  };
}

function getUnshareRefusal(guardianName: string, bookingCount: number): string {
  const bookings =
    bookingCount === 1
      ? "1 upcoming Booking for their Children is there. Change it"
      : `${bookingCount} upcoming Bookings for their Children are there. Change them`;
  return `${guardianName} can’t be taken off this Home: ${bookings} to another Location first.`;
}

type HomeFormOptions = {
  isOpen: boolean;
  // Null adds a Home.
  home: HouseholdHome | null;
  // The family's live Guardians, who can own it.
  liveGuardians: NamedRef[];
  onSaved: (homeId: string) => void;
};

export type HomeForm = {
  draft: HomeDraft;
  errors: HomeErrors;
  failure: string | null;
  isSaving: boolean;
  setField: (field: keyof HomeFields, value: string) => void;
  toggleOwner: (guardianId: string, isChecked: boolean) => void;
  validate: () => void;
  submit: (event: FormEvent<HTMLFormElement>) => void;
};

export function useHomeForm({
  isOpen,
  home,
  liveGuardians,
  onSaved,
}: HomeFormOptions): HomeForm {
  const create = useMutation(familyMutations.createHome());
  const save = useMutation(homeSaveMutations.save());
  const { showToast } = useToast();
  const liveGuardianIds = liveGuardians.map((guardian) => guardian.id);
  const [saved, setSaved] = useState(() => getStartingDraft(home, liveGuardianIds));
  const [draft, setDraft] = useState(saved);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [errors, setErrors] = useState(NO_ERRORS);
  const [failure, setFailure] = useState<string | null>(null);
  const mustPickOwner = liveGuardians.length > 1;
  const isSaving = create.isPending || save.isPending;

  // Every open starts from the Home as it is. Adjusted during render, not
  // in an effect, so the first frame is right.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      const start = getStartingDraft(home, liveGuardianIds);
      setSaved(start);
      setDraft(start);
      setHasSubmitted(false);
      setErrors(NO_ERRORS);
      setFailure(null);
    }
  }

  function handleSaveError(error: unknown): void {
    if (!(error instanceof HomeSaveError)) {
      setFailure(SAVE_FAILED);
      return;
    }
    const { applied, failedUnshares } = error;
    const keptFields = applied.hasSavedFields ? draft : saved;
    const now = { ...keptFields, ownerIds: applied.ownerIds };
    setSaved(now);
    setDraft((current) => ({ ...current, ownerIds: applied.ownerIds }));
    // One sentence per refused Guardian; anything else is the plain line.
    const refusals = failedUnshares.map(({ guardianId, cause }) => {
      const bookingIds = bookingIdsOf(cause);
      const owner = liveGuardians.find((guardian) => guardian.id === guardianId);
      return owner && bookingIds
        ? getUnshareRefusal(owner.name, bookingIds.length)
        : null;
    });
    const isAllRefusals =
      refusals.length > 0 && refusals.every((refusal) => refusal !== null);
    setFailure(isAllRefusals ? refusals.join(" ") : SAVE_FAILED);
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (isSaving) return;
    setHasSubmitted(true);
    setFailure(null);
    const nextErrors = getErrors(draft, mustPickOwner);
    setErrors(nextErrors);
    if (nextErrors.address || nextErrors.owners) return;

    if (!home) {
      create.mutate(
        { ...toWire(draft), guardian_ids: draft.ownerIds },
        {
          onSuccess: (created) => {
            showToast({ tone: "success", message: "Home added." });
            onSaved(created.id);
          },
          onError: () => setFailure(SAVE_FAILED),
        },
      );
      return;
    }
    save.mutate(
      {
        homeId: home.id,
        changes: getChanges(saved, draft),
        currentOwnerIds: saved.ownerIds,
        wantedOwnerIds: draft.ownerIds,
      },
      {
        onSuccess: () => {
          showToast({ tone: "success", message: "Home saved." });
          onSaved(home.id);
        },
        onError: handleSaveError,
      },
    );
  }

  return {
    draft,
    errors: {
      ...errors,
      // Ticks have no blur: their check follows them once submitted.
      owners: hasSubmitted ? getErrors(draft, mustPickOwner).owners : null,
    },
    failure,
    isSaving,
    setField: (field, value) =>
      setDraft((current) => ({ ...current, [field]: value })),
    toggleOwner: (guardianId, isChecked) =>
      setDraft((current) => ({
        ...current,
        ownerIds: isChecked
          ? [...current.ownerIds, guardianId]
          : current.ownerIds.filter((id) => id !== guardianId),
      })),
    validate: () => {
      if (hasSubmitted) setErrors(getErrors(draft, mustPickOwner));
    },
    submit,
  };
}
