import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { staffQueries } from "@/lib/queries/staff";
import type { Staff } from "@/lib/queries/staff";

const network = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get },
}));

const MARCO: Staff = {
  id: "u-tutor",
  name: "Marco Bell",
  role: "tutor",
  tutor_id: "t-1",
};

beforeEach(() => {
  network.get.mockReset();
});

describe("staffQueries.active", () => {
  it("asks for live Staff only and returns the page", async () => {
    network.get.mockResolvedValue({
      data: { items: [MARCO], total: 1, page: 1, page_size: 100 },
    });

    const staff = await new QueryClient().fetchQuery(staffQueries.active());

    expect(staff.items).toEqual([MARCO]);
    expect(network.get).toHaveBeenCalledWith("/api/staff", {
      params: { archived: false, page_size: 100 },
    });
  });
});
