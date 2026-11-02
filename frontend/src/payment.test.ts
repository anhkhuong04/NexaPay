import { afterEach, expect, it } from "vitest";
import {
  readRecovery,
  saveRecovery,
  RECOVERY_KEY,
  cacheTerminal,
  type CommandResult,
} from "./funding";
import {
  rememberIntent,
  readMemoryIntent,
  retainActorDraft,
} from "./moneyDrafts";
import {
  readCreate,
  readCreateDraft,
  saveCreate,
  clearCreate,
  REQUEST_CREATE_KEY,
} from "./payment";
import { makeQueryClient, replaceActor, safeReturnTo } from "./session";
const uuid = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
afterEach(() => {
  sessionStorage.clear();
  retainActorDraft(null);
  clearCreate();
});
it("preserves a reference-only PAYMENT intent through same-actor reauth without accepting cross actor/epoch", async () => {
  const ref = {
    actorId: "A",
    environmentEpoch: "epoch",
    operationType: "PAYMENT" as const,
    checkoutRef: uuid,
    key,
  };
  saveRecovery(ref);
  rememberIntent({
    ...ref,
    body: { reference: uuid, amount: "10000", currency: "VND" },
  });
  expect(sessionStorage.getItem(RECOVERY_KEY)).not.toContain("amount");
  expect(readRecovery("A", "epoch")).toEqual(ref);
  expect(readMemoryIntent(ref)?.operationType).toBe("PAYMENT");
  const client = makeQueryClient();
  await replaceActor(client, {
    userId: "A",
    roles: ["INDIVIDUAL"],
    authenticatedAt: "",
    absoluteExpiresAt: "",
  });
  expect(readRecovery("A", "epoch")).toEqual(ref);
  expect(readMemoryIntent(ref)).not.toBeNull();
  expect(readRecovery("B", "epoch")).toBeNull();
  expect(readRecovery("A", "other")).toBeNull();
});
it("creation recovery keeps only same-actor reference across reauth and discards memory on logout", async () => {
  const ref = { actor: "A", merchant: "M", epoch: "E", key };
  saveCreate(ref, {
    amount: "1",
    currency: "VND",
    description: "Private draft",
    expiryMinutes: 30,
  });
  expect(sessionStorage.getItem(REQUEST_CREATE_KEY)).not.toContain(
    "Private draft",
  );
  const client = makeQueryClient();
  await replaceActor(client, {
    userId: "A",
    roles: [],
    authenticatedAt: "",
    absoluteExpiresAt: "",
  });
  expect(readCreate("A", "M", "E")).toEqual(ref);
  expect(readCreateDraft(ref)?.description).toBe("Private draft");
  await replaceActor(client, null);
  expect(readCreateDraft(ref)).toBeNull();
  expect(readCreate("A", "M", "E")).toBeNull();
});
it("checkout returnTo is exact local UUID only", () => {
  expect(safeReturnTo(`/pay/${uuid}`)).toBe(`/pay/${uuid}`);
  for (const path of [
    `//evil.test/pay/${uuid}`,
    `/pay/${uuid}?redirect=https://evil.test`,
    `/pay/${uuid}/../x`,
    "/pay/not-a-uuid",
    "https://evil.test",
  ]) {
    expect(safeReturnTo(path)).toBe("/app/overview");
  }
});
it("late payment result cannot write an old actor command into a new actor cache", () => {
  const client = makeQueryClient();
  client.setQueryData(["session"], { userId: "B" });
  const result: CommandResult = {
    key,
    operationType: "PAYMENT",
    resourceId: uuid,
    status: "SUCCEEDED",
    originalHttpStatus: 201,
    createdAt: "2026-11-02T00:00:00Z",
    result: { amount: "1", requestRef: uuid },
    error: {},
  };
  expect(cacheTerminal(client, "A", result)).toBe(false);
  expect(client.getQueryData(["command", "A", "PAYMENT", key])).toBeUndefined();
  client.clear();
});
