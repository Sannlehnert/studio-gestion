import { QueryClient } from "@tanstack/vue-query";
import { ApiFailure } from "../shared/api/errors";
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30000,
        gcTime: 300000,
        refetchOnWindowFocus: false,
        retry: (count, error) =>
          count < 1 &&
          error instanceof ApiFailure &&
          error.kind === "network" &&
          !error.uncertain,
      },
      mutations: { retry: false, gcTime: 0 },
    },
  });
}
