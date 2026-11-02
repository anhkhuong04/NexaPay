import { REQUEST_CREATE_KEY, retainCreateDraft } from "./payment";
import { QueryCache, QueryClient, queryOptions } from "@tanstack/react-query";
import { api, ApiError, type Session } from "./api";
import { retainActorDraft } from "./moneyDrafts";
import { RECOVERY_KEY } from "./funding";

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
  retainActorDraft(session?.userId ?? null);
  retainCreateDraft(session?.userId ?? null);
  let creation: string | null = null;
  try {
    const value = sessionStorage.getItem(REQUEST_CREATE_KEY);
    if (session && value && JSON.parse(value).actor === session.userId)
      creation = value;
  } catch {
    /* discard invalid/cross-actor reference */
  }
  let recovery: string | null = null;
  try {
    const value = sessionStorage.getItem(RECOVERY_KEY);
    if (session && value && JSON.parse(value).actorId === session.userId)
      recovery = value;
  } catch {
    /* Discard invalid or cross-actor context. */
  }
  await client.cancelQueries();
  client.clear();
  client.setQueryData(["session"], session);
  for (const key of Object.keys(sessionStorage))
    if (key.startsWith("nexapay.")) sessionStorage.removeItem(key);
  if (recovery) sessionStorage.setItem(RECOVERY_KEY, recovery);
  if (creation) sessionStorage.setItem(REQUEST_CREATE_KEY, creation);
}
export function safeReturnTo(value: unknown) {
  return typeof value === "string" &&
    ([
      "/business/payment-requests",
      "/business/payment-requests/new",
      "/business/transactions",
      "/business/refunds",
      "/business/onboarding",
      "/business/overview",
      "/business/settings",
      "/app/profile",
      "/app/add-demo-funds",
      "/app/commands",
      "/app/send",
      "/app/transactions",
    ].includes(value) ||
      /^\/business\/payments\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/refund$/i.test(
        value,
      ) ||
      /^\/pay\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      ))
    ? value
    : "/app/overview";
}
