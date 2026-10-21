// Saving an edited Home: its fields (PATCH) and who it belongs to (one
// share or unshare per Guardian). An unshare can be refused while that
// Guardian's Children have upcoming Bookings there, so a save can stop
// part-way; HomeSaveError says what already reached the server and
// which unshares failed.
//   saveHome(edit)          throws HomeSaveError when any step fails
//   homeSaveMutations.save() mutationOptions around it
import { mutationOptions } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { refreshFamilies } from "@/lib/queries/families";
import type { HomeUpdate } from "@/types/families";

export type HomeEdit = {
  homeId: string;
  // Only the changed fields; empty when none changed.
  changes: HomeUpdate;
  currentOwnerIds: string[];
  wantedOwnerIds: string[];
};

export type HomeSaveApplied = {
  hasSavedFields: boolean;
  // The Home's owners on the server once the save stopped.
  ownerIds: string[];
};

// An unshare the API refused; `cause` carries its `booking_ids`.
export type UnshareFailure = { guardianId: string; cause: unknown };

export class HomeSaveError extends Error {
  readonly applied: HomeSaveApplied;
  // Every unshare that failed; empty when the PATCH or a share did.
  readonly failedUnshares: UnshareFailure[];

  constructor(
    applied: HomeSaveApplied,
    failedUnshares: UnshareFailure[],
    cause: unknown,
  ) {
    super("Couldn’t save every change to the Home", { cause });
    this.name = "HomeSaveError";
    this.applied = applied;
    this.failedUnshares = failedUnshares;
  }
}

// Shares go before unshares, so the Home never drops to no Guardian
// part-way (the API refuses that). A PATCH or share failure stops the
// save; each unshare is tried on its own, since one Guardian's Bookings
// say nothing about another's.
export async function saveHome({
  homeId,
  changes,
  currentOwnerIds,
  wantedOwnerIds,
}: HomeEdit): Promise<HomeSaveApplied> {
  const shares = wantedOwnerIds.filter((id) => !currentOwnerIds.includes(id));
  const unshares = currentOwnerIds.filter((id) => !wantedOwnerIds.includes(id));
  const applied: HomeSaveApplied = {
    hasSavedFields: false,
    ownerIds: [...currentOwnerIds],
  };
  try {
    if (Object.keys(changes).length > 0) {
      await api.patch(`/api/homes/${homeId}`, changes);
      applied.hasSavedFields = true;
    }
    for (const guardianId of shares) {
      await api.post(`/api/homes/${homeId}/guardians`, {
        guardian_id: guardianId,
      });
      applied.ownerIds = [...applied.ownerIds, guardianId];
    }
  } catch (error) {
    throw new HomeSaveError(applied, [], error);
  }

  const failedUnshares: UnshareFailure[] = [];
  for (const guardianId of unshares) {
    try {
      await api.delete(`/api/homes/${homeId}/guardians/${guardianId}`);
      applied.ownerIds = applied.ownerIds.filter((id) => id !== guardianId);
    } catch (error) {
      failedUnshares.push({ guardianId, cause: error });
    }
  }
  if (failedUnshares.length > 0) {
    throw new HomeSaveError(applied, failedUnshares, failedUnshares[0].cause);
  }
  return applied;
}

export const homeSaveMutations = {
  save: () =>
    mutationOptions({
      mutationFn: saveHome,
      // A part-way failure changed the server too.
      onSettled: (_data, _error, _vars, _result, { client }) =>
        refreshFamilies(client),
    }),
};
