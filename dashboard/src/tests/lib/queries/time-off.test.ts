import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import type { AxiosResponse } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTimeOff,
  decideTimeOff,
  replaceCachedTimeOff,
  sendTimeOffDecision,
  timeOffMutations,
  timeOffQueries,
} from "@/lib/queries/time-off";
import type { ExceptionRead, TimeOffWarning } from "@/lib/queries/time-off";

const network = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get, post: network.post, patch: network.patch },
}));

const ROW: ExceptionRead = {
  id: "to-1",
  staff: { id: "u-tutor", name: "Marco Bell", role: "tutor" },
  start_date: "2031-10-20",
  end_date: "2031-10-22",
  start_time: null,
  end_time: null,
  reason: "Family trip",
  status: "approved",
  created_at: "2031-10-14T19:10:00Z",
  decided_by: { id: "u-admin", name: "Rita Souza" },
  decided_at: "2031-10-14T19:10:00Z",
  cancelled_by: null,
  cancelled_at: null,
  entered_by: { id: "u-admin", name: "Rita Souza" },
  clashing_bookings: [],
  clashing_bookings_count: 0,
};

const CLASH: TimeOffWarning = {
  code: "booking_clash",
  message: "This time off clashes with 1 booking(s)",
  clashing_bookings: [
    {
      booking_id: "b-1",
      date: "2031-10-20",
      start_time: "15:30:00",
      end_time: "16:30:00",
      child_name: "Emma",
      status: "confirmed",
    },
  ],
};

function apiError(status: number, data: object): AxiosError {
  const response = { status, data, statusText: "", headers: {} };
  return new AxiosError(
    "Request failed",
    "ERR_BAD_REQUEST",
    undefined,
    undefined,
    response as AxiosResponse,
  );
}

beforeEach(() => {
  network.get.mockReset();
  network.post.mockReset();
  network.patch.mockReset();
});

describe("createTimeOff", () => {
  it("returns the created row", async () => {
    network.post.mockResolvedValue({ status: 201, data: ROW });
    const body = { start_date: "2031-10-20", end_date: "2031-10-22" };

    const result = await createTimeOff("u-tutor", body);

    expect(result).toEqual({ kind: "saved", item: ROW });
    expect(network.post).toHaveBeenCalledWith(
      "/api/users/u-tutor/exceptions",
      body,
    );
  });

  it("returns the clash warning as a value, not an error", async () => {
    network.post.mockRejectedValue(
      apiError(409, { detail: "Confirm the warnings", warnings: [CLASH] }),
    );

    const result = await createTimeOff("u-tutor", {
      start_date: "2031-10-20",
      end_date: "2031-10-22",
    });

    expect(result).toEqual({ kind: "warning", warnings: [CLASH] });
  });

  it("still throws a refusal that carries no warnings", async () => {
    const refusal = apiError(422, { detail: "That window has ended" });
    network.post.mockRejectedValue(refusal);

    await expect(
      createTimeOff("u-tutor", {
        start_date: "2020-01-01",
        end_date: "2020-01-01",
      }),
    ).rejects.toBe(refusal);
  });
});

describe("decideTimeOff", () => {
  it("sends booking_clash when the clashes are confirmed", async () => {
    network.patch.mockResolvedValue({ status: 200, data: ROW });

    await decideTimeOff("to-1", "approved", true);

    expect(network.patch).toHaveBeenCalledWith("/api/exceptions/to-1", {
      status: "approved",
      confirm_warnings: ["booking_clash"],
    });
  });

  it("throws an already-decided 409, which has no warnings", async () => {
    const conflict = apiError(409, { detail: "Already decided" });
    network.patch.mockRejectedValue(conflict);

    await expect(decideTimeOff("to-1", "rejected", false)).rejects.toBe(
      conflict,
    );
  });
});

describe("sendTimeOffDecision", () => {
  it("approves with the clashes confirmed", async () => {
    network.patch.mockResolvedValue({ status: 200, data: ROW });

    const item = await sendTimeOffDecision("to-1", "approved", false);

    expect(item).toEqual(ROW);
    expect(network.patch).toHaveBeenCalledWith(
      "/api/exceptions/to-1",
      { status: "approved", confirm_warnings: ["booking_clash"] },
      {},
    );
  });

  it("declines with the status alone, over keepalive when asked", async () => {
    network.patch.mockResolvedValue({ status: 200, data: ROW });

    await sendTimeOffDecision("to-1", "rejected", true);

    expect(network.patch).toHaveBeenCalledWith(
      "/api/exceptions/to-1",
      { status: "rejected" },
      { adapter: "fetch", fetchOptions: { keepalive: true } },
    );
  });

  it("throws any refusal, a clash warning included", async () => {
    const conflict = apiError(409, { detail: "Confirm", warnings: [CLASH] });
    network.patch.mockRejectedValue(conflict);

    await expect(sendTimeOffDecision("to-1", "rejected", false)).rejects.toBe(
      conflict,
    );
  });
});

describe("replaceCachedTimeOff", () => {
  it("swaps the row in its detail and in every list holding it", () => {
    const client = new QueryClient();
    const other = { ...ROW, id: "to-2" };
    const page = (items: ExceptionRead[]) => ({
      items,
      total: items.length,
      page: 1,
      page_size: 20,
    });
    const listKey = timeOffQueries.list({ status: ["pending"] }).queryKey;
    const userKey = timeOffQueries.forUser("u-tutor").queryKey;
    const detailKey = timeOffQueries.detail("to-1").queryKey;
    client.setQueryData(listKey, page([ROW, other]));
    client.setQueryData(userKey, page([other]));
    client.setQueryData(detailKey, ROW);
    const declined = { ...ROW, status: "rejected" as const };

    replaceCachedTimeOff(client, declined);

    expect(client.getQueryData(detailKey)).toEqual(declined);
    expect(client.getQueryData(listKey)?.items).toEqual([declined, other]);
    expect(client.getQueryData(userKey)?.items).toEqual([other]);
  });
});

describe("the list query", () => {
  it("repeats status for each one asked for", async () => {
    network.get.mockResolvedValue({ data: { items: [] } });
    const options = timeOffQueries.list({
      status: ["pending", "expired"],
      sort: "requested",
    });

    await new QueryClient().fetchQuery(options);

    const [url, config] = network.get.mock.calls[0];
    expect(url).toBe("/api/exceptions");
    expect(config.paramsSerializer(config.params)).toBe(
      "status=pending&status=expired&sort=requested",
    );
  });
});

describe("after a write", () => {
  it("refreshes Time off, Staff and the nav counts", async () => {
    network.post.mockResolvedValue({
      status: 200,
      data: { ...ROW, status: "cancelled" },
    });
    const client = new QueryClient();
    client.setQueryData(["time-off", "list", {}], { items: [] });
    client.setQueryData(["staff", "list"], { items: [] });
    client.setQueryData(["counts"], { time_off_pending: 1 });
    client.setQueryData(["bookings"], []);

    await new MutationObserver(client, timeOffMutations.cancel()).mutate("to-1");

    const isStale = (key: unknown[]) =>
      client.getQueryState(key)?.isInvalidated;
    expect(isStale(["time-off", "list", {}])).toBe(true);
    expect(isStale(["staff", "list"])).toBe(true);
    expect(isStale(["counts"])).toBe(true);
    expect(isStale(["bookings"])).toBe(false);
  });

  it("refreshes them even when the write is refused", async () => {
    network.post.mockRejectedValue(apiError(409, { detail: "Cancelled" }));
    const client = new QueryClient();
    client.setQueryData(["counts"], { time_off_pending: 1 });

    await expect(
      new MutationObserver(client, timeOffMutations.cancel()).mutate("to-1"),
    ).rejects.toThrow();

    expect(client.getQueryState(["counts"])?.isInvalidated).toBe(true);
  });
});

describe("timeOffQueries.listAll", () => {
  function pageOf(ids: string[], page: number, total: number) {
    return {
      data: {
        items: ids.map((id) => ({ ...ROW, id })),
        total,
        page,
        page_size: 100,
      },
    };
  }

  it("reads every page of the filtered list", async () => {
    network.get.mockImplementation(
      async (_url: string, config: { params: { page: number } }) =>
        config.params.page === 1
          ? pageOf(["to-1", "to-2"], 1, 201)
          : pageOf([`to-p${config.params.page}`], config.params.page, 201),
    );
    const client = new QueryClient();
    const result = await client.fetchQuery(
      timeOffQueries.listAll({ status: ["approved"], from: "2031-10-20" }),
    );
    expect(result.items.map((item) => item.id)).toEqual([
      "to-1",
      "to-2",
      "to-p2",
      "to-p3",
    ]);
    expect(result.total).toBe(201);
    const params = network.get.mock.calls.map(([, config]) => config.params);
    expect(params).toEqual([
      { status: ["approved"], from: "2031-10-20", page: 1, page_size: 100 },
      { status: ["approved"], from: "2031-10-20", page: 2, page_size: 100 },
      { status: ["approved"], from: "2031-10-20", page: 3, page_size: 100 },
    ]);
  });

  it("reads every page of one person's own list", async () => {
    network.get.mockResolvedValue(pageOf(["to-1"], 1, 1));
    const client = new QueryClient();
    const result = await client.fetchQuery(timeOffQueries.forUserAll("u-tutor"));
    expect(result.items).toHaveLength(1);
    expect(network.get).toHaveBeenCalledWith("/api/users/u-tutor/exceptions", {
      params: { page: 1, page_size: 100 },
    });
  });
});
