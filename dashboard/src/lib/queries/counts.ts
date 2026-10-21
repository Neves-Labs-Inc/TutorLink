import { queryOptions } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CountsRead } from "@/components/kit/shell/nav";

// The nav badges refresh on this beat as well as on window focus.
const COUNTS_REFRESH_MS = 60_000;

// GET /api/counts is Office only (403 for a Tutor); callers gate it.
export const countsQueries = {
  detail: () =>
    queryOptions({
      queryKey: ["counts"],
      queryFn: async (): Promise<CountsRead> => {
        const response = await api.get<CountsRead>("/api/counts");
        return response.data;
      },
      refetchInterval: COUNTS_REFRESH_MS,
      refetchOnWindowFocus: true,
    }),
};
