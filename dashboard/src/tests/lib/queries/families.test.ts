import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { familyQueries } from "@/lib/queries/families";

const network = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/lib/api", () => ({ api: { get: network.get } }));

beforeEach(() => {
  network.get.mockReset().mockResolvedValue({ data: {} });
});

describe("familyQueries.household", () => {
  it("keeps a member id from the URL inside its own path segment", async () => {
    await new QueryClient().fetchQuery(familyQueries.household("../staff"));
    expect(network.get).toHaveBeenCalledWith("/api/households/..%2Fstaff");
  });
});
