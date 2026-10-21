// Families URLs, a named contract: Home's Needs a Tutor rows, Staff ›
// Children and the Chats Guardian link build their links with these.
//   familyPath(memberId)                    /families/:memberId
//   familyChildPath(memberId, childId)      …?child=:childId
//   familyGuardianPath(memberId, guardianId) …?guardian=:guardianId
// `memberId` is any Guardian's or Child's id: the API finds the same
// family from either. On the family page, `?child=` / `?guardian=` opens
// that record's details over it.
export const FAMILIES_PATH = "/families";

const CHILD_PARAM = "child";
const GUARDIAN_PARAM = "guardian";

export type DetailKind = "child" | "guardian";

export type DetailEntry = { kind: DetailKind; id: string };

const PARAM_BY_KIND: Record<DetailKind, string> = {
  child: CHILD_PARAM,
  guardian: GUARDIAN_PARAM,
};

export function familyPath(memberId: string): string {
  return `${FAMILIES_PATH}/${encodeURIComponent(memberId)}`;
}

export function familyChildPath(memberId: string, childId: string): string {
  return `${familyPath(memberId)}?${CHILD_PARAM}=${encodeURIComponent(childId)}`;
}

export function familyGuardianPath(
  memberId: string,
  guardianId: string,
): string {
  return `${familyPath(memberId)}?${GUARDIAN_PARAM}=${encodeURIComponent(guardianId)}`;
}

// Where an old /children(/:id) or /guardians(/:id) URL now lives. A
// record's own id finds its family, so it is also the member id.
export function getLegacyRedirect(kind: DetailKind, id?: string): string {
  if (!id) return FAMILIES_PATH;

  return kind === "child" ? familyChildPath(id, id) : familyGuardianPath(id, id);
}

// The record the URL opens; a Child wins if both are set.
export function readDetailEntry(params: URLSearchParams): DetailEntry | null {
  const childId = params.get(CHILD_PARAM);
  const guardianId = params.get(GUARDIAN_PARAM);
  let entry: DetailEntry | null = null;
  if (childId) {
    entry = { kind: "child", id: childId };
  } else if (guardianId) {
    entry = { kind: "guardian", id: guardianId };
  }
  return entry;
}

// The search string (with "?", or "" when empty) opening `entry`, or no
// record when null; other params stay.
export function withDetailEntry(
  params: URLSearchParams,
  entry: DetailEntry | null,
): string {
  const next = new URLSearchParams(params);
  next.delete(CHILD_PARAM);
  next.delete(GUARDIAN_PARAM);
  if (entry) next.set(PARAM_BY_KIND[entry.kind], entry.id);
  const search = next.toString();
  return search ? `?${search}` : "";
}
