import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveSubject,
  refreshSubjects,
  restoreSubject,
  subjectQueries,
  updateSubject,
} from "@/lib/queries/subjects";

const network = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: network,
}));

const ARCHIVE_READ = {
  type: "subject",
  id: "s-1",
  archived: true,
  cancelled_booking_ids: [],
  archived_child_ids: [],
};

beforeEach(() => {
  for (const mock of Object.values(network)) mock.mockReset();
});

describe("archiveSubject and restoreSubject", () => {
  it("posts the subject to /api/archive", async () => {
    network.post.mockResolvedValue({ data: ARCHIVE_READ });

    const result = await archiveSubject("s-1");

    expect(result).toEqual(ARCHIVE_READ);
    expect(network.post).toHaveBeenCalledWith("/api/archive", { type: "subject", id: "s-1" });
  });

  it("posts the subject to /api/restore", async () => {
    network.post.mockResolvedValue({ data: { ...ARCHIVE_READ, archived: false } });

    await restoreSubject("s-1");

    expect(network.post).toHaveBeenCalledWith("/api/restore", { type: "subject", id: "s-1" });
  });
});

describe("updateSubject", () => {
  it("encodes the id in the path", async () => {
    network.patch.mockResolvedValue({ data: {} });

    await updateSubject("a/b?c", { name: "Math" });

    expect(network.patch).toHaveBeenCalledWith("/api/subjects/a%2Fb%3Fc", { name: "Math" });
  });
});

describe("subjectQueries.list", () => {
  it("passes archived through to the API", async () => {
    network.get.mockResolvedValue({ data: { items: [], total: 0, page: 1, page_size: 20 } });

    await new QueryClient().fetchQuery(subjectQueries.list({ archived: true }));

    expect(network.get).toHaveBeenCalledWith("/api/subjects", {
      params: expect.objectContaining({ archived: true }),
    });
  });
});

describe("refreshSubjects", () => {
  it("invalidates both the list and the active queries", async () => {
    const client = new QueryClient();
    network.get.mockResolvedValue({ data: { items: [], total: 0, page: 1, page_size: 100 } });
    await client.fetchQuery(subjectQueries.list());
    await client.fetchQuery(subjectQueries.active());

    await refreshSubjects(client);

    expect(client.getQueryState(subjectQueries.list().queryKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(subjectQueries.active().queryKey)?.isInvalidated).toBe(true);
  });
});
