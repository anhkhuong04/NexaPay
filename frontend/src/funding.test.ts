import { afterEach, expect, it, vi } from "vitest";
import {
  fundingApi,
  readRecovery,
  saveRecovery,
  RECOVERY_KEY,
  cacheTerminal,
  type CommandResult,
} from "./funding";
import { makeQueryClient, replaceActor } from "./session";

const key = "11111111-1111-4111-8111-111111111111";
afterEach(() => vi.unstubAllGlobals());
it("does not cache a late money response after logout or account switch", async () => {
  const client = makeQueryClient();
  const result: CommandResult = {
    key,
    operationType: "DEMO_FUNDING",
    resourceId: key,
    status: "FAILED",
    originalHttpStatus: 422,
    createdAt: "2026-01-01T00:00:00Z",
    result: {},
    error: { code: "WALLET_LOCKED" },
  };
  await replaceActor(client, {
    userId: "B",
    roles: ["INDIVIDUAL"],
    authenticatedAt: "",
    absoluteExpiresAt: "",
  });
  expect(cacheTerminal(client, "A", result)).toBe(false);
  expect(
    client.getQueryData(["command", "A", "DEMO_FUNDING", key]),
  ).toBeUndefined();
  await replaceActor(client, null);
  expect(cacheTerminal(client, "A", result)).toBe(false);
  client.clear();
});
it("stores only a reference, discards another actor/epoch and never stores a body", () => {
  const ref = {
    actorId: "A",
    environmentEpoch: "epoch",
    operationType: "DEMO_FUNDING" as const,
    key,
  };
  saveRecovery(ref);
  expect(JSON.parse(sessionStorage.getItem(RECOVERY_KEY)!)).toEqual(ref);
  expect(readRecovery("A", "epoch")).toEqual(ref);
  expect(readRecovery("B", "epoch")).toBeNull();
  saveRecovery(ref);
  expect(readRecovery("A", "new-epoch")).toBeNull();
});
it("keeps same-actor reference on reauthentication and clears on logout/switch", async () => {
  const client = makeQueryClient();
  const session = {
    userId: "A",
    roles: ["INDIVIDUAL"],
    authenticatedAt: "",
    absoluteExpiresAt: "",
  };
  saveRecovery({
    actorId: "A",
    environmentEpoch: "epoch",
    operationType: "DEMO_FUNDING",
    key,
  });
  await replaceActor(client, session);
  expect(readRecovery("A", "epoch")?.key).toBe(key);
  await replaceActor(client, { ...session, userId: "B" });
  expect(sessionStorage.getItem(RECOVERY_KEY)).toBeNull();
  saveRecovery({
    actorId: "B",
    environmentEpoch: "epoch",
    operationType: "DEMO_FUNDING",
    key,
  });
  await replaceActor(client, null);
  expect(sessionStorage.getItem(RECOVERY_KEY)).toBeNull();
  client.clear();
});
it("accepts committed 422 as terminal and preserves POST key/body without automatic retry", async () => {
  const terminal = { key, status: "FAILED", originalHttpStatus: 422 };
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ token: "test-token", headerName: "X-CSRF-TOKEN" }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify(terminal), { status: 422 }),
    );
  vi.stubGlobal("fetch", fetch);
  const body = { amount: "100000", currency: "VND" as const };
  expect(await fundingApi.fund(key, body)).toEqual(terminal);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][1].headers["Idempotency-Key"]).toBe(key);
  expect(fetch.mock.calls[1][1].body).toBe(JSON.stringify(body));
});
