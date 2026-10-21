import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AssignedTutorsSaveError,
  saveAssignedTutors,
} from "@/lib/queries/assigned-tutors";

const network = vi.hoisted(() => ({ post: vi.fn(), delete: vi.fn() }));

vi.mock("@/lib/api", () => ({
  api: { post: network.post, delete: network.delete },
}));

beforeEach(() => {
  network.post.mockReset().mockResolvedValue({ data: [] });
  network.delete.mockReset().mockResolvedValue({ data: undefined });
});

describe("saveAssignedTutors", () => {
  it("assigns the new picks before removing the dropped ones", async () => {
    const calls: string[] = [];
    network.post.mockImplementation(async (url: string, body: unknown) => {
      calls.push(`POST ${url} ${JSON.stringify(body)}`);
      return { data: [] };
    });
    network.delete.mockImplementation(async (url: string) => {
      calls.push(`DELETE ${url}`);
      return { data: undefined };
    });

    const applied = await saveAssignedTutors("c-1", ["ana", "marco"], ["marco", "sofia"]);

    expect(applied).toEqual({ add: ["sofia"], remove: ["ana"] });
    expect(calls).toEqual([
      'POST /api/children/c-1/assigned-tutors {"user_id":"sofia"}',
      "DELETE /api/children/c-1/assigned-tutors/ana",
    ]);
  });

  it("sends nothing when the picks are unchanged", async () => {
    await saveAssignedTutors("c-1", ["ana"], ["ana"]);
    expect(network.post).not.toHaveBeenCalled();
    expect(network.delete).not.toHaveBeenCalled();
  });

  it("stops at the first failure and reports what it applied", async () => {
    const refusal = new Error("409");
    network.post
      .mockResolvedValueOnce({ data: [] })
      .mockRejectedValueOnce(refusal);

    const saving = saveAssignedTutors("c-1", ["ana"], ["marco", "sofia"]);

    await expect(saving).rejects.toBeInstanceOf(AssignedTutorsSaveError);
    const error = await saving.catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      applied: { add: ["marco"], remove: [] },
      cause: refusal,
    });
    expect(network.post).toHaveBeenCalledTimes(2);
    expect(network.delete).not.toHaveBeenCalled();
  });
});
