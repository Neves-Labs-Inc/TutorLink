// The Families data module: query options and mutations, typed from
// api/app/schemas/ (see @/types/families). Other areas use parts of it,
// so keep these exports stable:
//   familyQueries.households / household / child / guardian /
//     guardianSearch / reminders / activeSubjects
//   familyMutations.<write>() → mutationOptions for useMutation
// Every write refreshes the families list, the open family and its
// members' details; writes that move a To do count refresh /api/counts.
// Keys share the old screens' namespaces ("households", "children",
// "guardians") where the endpoint is the same, so writes from either
// side refresh both.
import {
  keepPreviousData,
  mutationOptions,
  queryOptions,
} from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  ArchiveRead,
  ArchiveTarget,
  ChildCreate,
  ChildDetail,
  ChildLevelRead,
  ChildRead,
  ChildUpdate,
  ClientCreate,
  ClientRead,
  ClientSummary,
  ClientUpdate,
  ConsentAction,
  EvaluatedRead,
  GuardianRemindersRead,
  HomeRead,
  HomeUpdate,
  HouseholdListParams,
  HouseholdRead,
  Language,
  Page,
  SharedHomeCreate,
  SubjectRead,
} from "@/types/families";

export const FAMILIES_PAGE_SIZE = 50;
// The API's page cap; the Office has far fewer active Subjects.
const SUBJECTS_PAGE_SIZE = 100;
const GUARDIAN_SEARCH_PAGE_SIZE = 20;

export const familyKeys = {
  households: ["households"] as const,
  householdList: (params: HouseholdListParams) =>
    ["households", "families", params] as const,
  household: (memberId: string) => ["households", "detail", memberId] as const,
  children: ["children", "detail"] as const,
  child: (childId: string) => ["children", "detail", childId] as const,
  guardians: ["guardians", "detail"] as const,
  guardian: (guardianId: string) =>
    ["guardians", "detail", guardianId] as const,
  guardianSearch: (q: string) => ["guardians", "search", q] as const,
  reminders: (guardianId: string) =>
    ["guardians", "reminders", guardianId] as const,
  activeSubjects: ["subjects", "active"] as const,
  counts: ["counts"] as const,
  staff: ["staff"] as const,
};

export const familyQueries = {
  households: (params: HouseholdListParams = {}) =>
    queryOptions({
      queryKey: familyKeys.householdList(params),
      queryFn: async (): Promise<Page<HouseholdRead>> => {
        const response = await api.get<Page<HouseholdRead>>("/api/households", {
          params: { page_size: FAMILIES_PAGE_SIZE, ...params },
        });
        return response.data;
      },
      placeholderData: keepPreviousData,
    }),

  // 404 "Family not found" when no Guardian or Child has this id.
  household: (memberId: string) =>
    queryOptions({
      queryKey: familyKeys.household(memberId),
      queryFn: async (): Promise<HouseholdRead> => {
        const response = await api.get<HouseholdRead>(
          // The id comes from the URL: keep it inside its own segment.
          `/api/households/${encodeURIComponent(memberId)}`,
        );
        return response.data;
      },
    }),

  child: (childId: string) =>
    queryOptions({
      queryKey: familyKeys.child(childId),
      queryFn: async (): Promise<ChildDetail> => {
        const response = await api.get<ChildDetail>(`/api/children/${childId}`);
        return response.data;
      },
    }),

  guardian: (guardianId: string) =>
    queryOptions({
      queryKey: familyKeys.guardian(guardianId),
      queryFn: async (): Promise<ClientRead> => {
        const response = await api.get<ClientRead>(`/api/clients/${guardianId}`);
        return response.data;
      },
    }),

  // Pickers: active Guardians by name or phone.
  guardianSearch: (q: string) =>
    queryOptions({
      queryKey: familyKeys.guardianSearch(q),
      queryFn: async (): Promise<Page<ClientSummary>> => {
        const response = await api.get<Page<ClientSummary>>("/api/clients", {
          params: {
            q: q || undefined,
            archived: false,
            page_size: GUARDIAN_SEARCH_PAGE_SIZE,
          },
        });
        return response.data;
      },
      placeholderData: keepPreviousData,
    }),

  reminders: (guardianId: string) =>
    queryOptions({
      queryKey: familyKeys.reminders(guardianId),
      queryFn: async (): Promise<GuardianRemindersRead> => {
        const response = await api.get<GuardianRemindersRead>(
          `/api/clients/${guardianId}/reminders`,
        );
        return response.data;
      },
    }),

  // For level pickers.
  activeSubjects: () =>
    queryOptions({
      queryKey: familyKeys.activeSubjects,
      queryFn: async (): Promise<SubjectRead[]> => {
        const response = await api.get<Page<SubjectRead>>("/api/subjects", {
          params: { archived: false, page_size: SUBJECTS_PAGE_SIZE },
        });
        return response.data.items;
      },
    }),
};

type RefreshScope = {
  // The write can move a To do count (Needs a Tutor, awaiting Evaluation).
  hasCounts?: boolean;
  // The write changes what Staff rows show (Assigned Tutors).
  hasStaff?: boolean;
  // The write changes a Guardian's reminders history.
  remindersOf?: string;
  // The write changes a chat (the Guardian language).
  hasConversations?: boolean;
  // The write cancels Bookings (an archive) or brings Children back.
  hasBookings?: boolean;
};

// Only queries on screen refetch; the rest are marked stale, so
// refreshing every member detail costs no more than the open family.
export async function refreshFamilies(
  client: QueryClient,
  scope: RefreshScope = {},
): Promise<void> {
  const keys: readonly (readonly unknown[])[] = [
    familyKeys.households,
    familyKeys.children,
    familyKeys.guardians,
    ...(scope.hasCounts ? [familyKeys.counts] : []),
    ...(scope.hasStaff ? [familyKeys.staff] : []),
    ...(scope.remindersOf ? [familyKeys.reminders(scope.remindersOf)] : []),
    ...(scope.hasConversations ? [["conversations"]] : []),
    ...(scope.hasBookings ? [["bookings"]] : []),
  ];
  await Promise.all(
    keys.map((queryKey) => client.invalidateQueries({ queryKey })),
  );
}

export type ChildPatch = { childId: string; changes: ChildUpdate };
export type GuardianLink = { childId: string; guardianId: string };
export type LevelSet = { childId: string; subjectId: string; level: number };
export type LevelRemoval = { childId: string; subjectId: string };
export type EvaluatedMark = { childId: string; tutorIds: string[] };
export type GuardianPatch = { guardianId: string; changes: ClientUpdate };
export type ConsentRecord = { guardianId: string; action: ConsentAction };
export type LanguageChange = {
  conversationId: string;
  language: Language | null;
};
export type HomePatch = { homeId: string; changes: HomeUpdate };
export type HomeShare = { homeId: string; guardianId: string };

export const familyMutations = {
  createChild: () =>
    mutationOptions({
      mutationFn: async (data: ChildCreate): Promise<ChildRead> => {
        const response = await api.post<ChildRead>("/api/children", data);
        return response.data;
      },
      onSuccess: (_data, _vars, _result, { client }) =>
        refreshFamilies(client, { hasCounts: true }),
    }),

  // Also unlinks: `guardian_ids` replaces the Child's Guardians.
  updateChild: () =>
    mutationOptions({
      mutationFn: async ({ childId, changes }: ChildPatch): Promise<ChildRead> => {
        const response = await api.patch<ChildRead>(
          `/api/children/${childId}`,
          changes,
        );
        return response.data;
      },
      onSuccess: (_data, _vars, _result, { client }) => refreshFamilies(client),
    }),

  linkGuardian: () =>
    mutationOptions({
      mutationFn: async ({
        childId,
        guardianId,
      }: GuardianLink): Promise<ChildRead> => {
        const response = await api.post<ChildRead>(
          `/api/children/${childId}/guardians`,
          { guardian_id: guardianId },
        );
        return response.data;
      },
      onSuccess: (_data, _vars, _result, { client }) => refreshFamilies(client),
    }),

  setLevel: () =>
    mutationOptions({
      mutationFn: async ({
        childId,
        subjectId,
        level,
      }: LevelSet): Promise<ChildLevelRead> => {
        const response = await api.put<ChildLevelRead>(
          `/api/children/${childId}/levels/${subjectId}`,
          { level },
        );
        return response.data;
      },
      onSuccess: (_data, _vars, _result, { client }) => refreshFamilies(client),
    }),

  removeLevel: () =>
    mutationOptions({
      mutationFn: async ({ childId, subjectId }: LevelRemoval): Promise<void> => {
        await api.delete(`/api/children/${childId}/levels/${subjectId}`);
      },
      onSuccess: (_data, _vars, _result, { client }) => refreshFamilies(client),
    }),

  // Also assigns `tutorIds` as the Child's first Assigned Tutors.
  markEvaluated: () =>
    mutationOptions({
      mutationFn: async ({
        childId,
        tutorIds,
      }: EvaluatedMark): Promise<EvaluatedRead> => {
        const response = await api.post<EvaluatedRead>(
          `/api/children/${childId}/evaluated`,
          { tutor_ids: tutorIds },
        );
        return response.data;
      },
      onSuccess: (_data, _vars, _result, { client }) =>
        refreshFamilies(client, { hasCounts: true, hasStaff: true }),
    }),

  // Keeps the Assigned Tutors.
  clearEvaluated: () =>
    mutationOptions({
      mutationFn: async (childId: string): Promise<void> => {
        await api.delete(`/api/children/${childId}/evaluated`);
      },
      onSuccess: (_data, _vars, _result, { client }) =>
        refreshFamilies(client, { hasCounts: true }),
    }),

  createGuardian: () =>
    mutationOptions({
      mutationFn: async (data: ClientCreate): Promise<ClientRead> => {
        const response = await api.post<ClientRead>("/api/clients", data);
        return response.data;
      },
      onSuccess: (_data, _vars, _result, { client }) => refreshFamilies(client),
    }),

  updateGuardian: () =>
    mutationOptions({
      mutationFn: async ({
        guardianId,
        changes,
      }: GuardianPatch): Promise<ClientRead> => {
        const response = await api.patch<ClientRead>(
          `/api/clients/${guardianId}`,
          changes,
        );
        return response.data;
      },
      onSuccess: (_data, _vars, _result, { client }) => refreshFamilies(client),
    }),

  // 409 while WhatsApp blocks the number.
  recordConsent: () =>
    mutationOptions({
      mutationFn: async ({
        guardianId,
        action,
      }: ConsentRecord): Promise<GuardianRemindersRead> => {
        const response = await api.post<GuardianRemindersRead>(
          `/api/clients/${guardianId}/reminders/consent`,
          { action },
        );
        return response.data;
      },
      onSuccess: (_data, { guardianId }, _result, { client }) =>
        refreshFamilies(client, { remindersOf: guardianId }),
    }),

  // The Guardian language lives on their latest chat
  // (`ClientRead.language_conversation_id`).
  setLanguage: () =>
    mutationOptions({
      mutationFn: async ({
        conversationId,
        language,
      }: LanguageChange): Promise<void> => {
        await api.patch(`/api/conversations/${conversationId}`, { language });
      },
      onSuccess: (_data, _vars, _result, { client }) =>
        refreshFamilies(client, { hasConversations: true }),
    }),

  createHome: () =>
    mutationOptions({
      mutationFn: async (data: SharedHomeCreate): Promise<HomeRead> => {
        const response = await api.post<HomeRead>("/api/homes", data);
        return response.data;
      },
      onSuccess: (_data, _vars, _result, { client }) => refreshFamilies(client),
    }),

  updateHome: () =>
    mutationOptions({
      mutationFn: async ({ homeId, changes }: HomePatch): Promise<HomeRead> => {
        const response = await api.patch<HomeRead>(`/api/homes/${homeId}`, changes);
        return response.data;
      },
      onSuccess: (_data, _vars, _result, { client }) => refreshFamilies(client),
    }),

  shareHome: () =>
    mutationOptions({
      mutationFn: async ({ homeId, guardianId }: HomeShare): Promise<HomeRead> => {
        const response = await api.post<HomeRead>(
          `/api/homes/${homeId}/guardians`,
          { guardian_id: guardianId },
        );
        return response.data;
      },
      onSuccess: (_data, _vars, _result, { client }) => refreshFamilies(client),
    }),

  // 409 with `booking_ids` when upcoming Bookings still use the Home.
  unshareHome: () =>
    mutationOptions({
      mutationFn: async ({ homeId, guardianId }: HomeShare): Promise<HomeRead> => {
        const response = await api.delete<HomeRead>(
          `/api/homes/${homeId}/guardians/${guardianId}`,
        );
        return response.data;
      },
      onSuccess: (_data, _vars, _result, { client }) => refreshFamilies(client),
    }),

  // 409 when `expected_cancellations` no longer matches, or (Home) with
  // `booking_ids` while upcoming Bookings use it.
  archive: () =>
    mutationOptions({
      mutationFn: async (target: ArchiveTarget): Promise<ArchiveRead> => {
        const response = await api.post<ArchiveRead>("/api/archive", target);
        return response.data;
      },
      onSuccess: (_data, _vars, _result, { client }) =>
        refreshFamilies(client, {
          hasCounts: true,
          hasStaff: true,
          hasBookings: true,
        }),
    }),

  restore: () =>
    mutationOptions({
      mutationFn: async (target: ArchiveTarget): Promise<ArchiveRead> => {
        const response = await api.post<ArchiveRead>("/api/restore", target);
        return response.data;
      },
      onSuccess: (_data, _vars, _result, { client }) =>
        refreshFamilies(client, {
          hasCounts: true,
          hasStaff: true,
          hasBookings: true,
        }),
    }),
};
