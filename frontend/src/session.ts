import { QueryCache, QueryClient, queryOptions } from "@tanstack/react-query";
import { api, ApiError, type Session } from "./api";

export function makeQueryClient() {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (
          error instanceof ApiError &&
          error.status === 401 &&
          query.queryKey[0] !== "session"
        )
          client.setQueryData(["session"], null);
      },
    }),
    defaultOptions: {
      queries: { retry: false, staleTime: 30_000 },
      mutations: { retry: false },
    },
  });
  return client;
}
export const sessionOptions = queryOptions({
  queryKey: ["session"],
  queryFn: async ({ signal }): Promise<Session | null> => {
    try {
      return await api.session(signal);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
});

export async function replaceActor(
  client: QueryClient,
  session: Session | null,
) {
  await client.cancelQueries();
  client.clear();
  client.setQueryData(["session"], session);
  for (const key of Object.keys(sessionStorage))
    if (key.startsWith("nexapay.")) sessionStorage.removeItem(key);
}
export function safeReturnTo(value: unknown) {
  return value === "/app/profile" ? "/app/profile" : "/app/overview";
}
