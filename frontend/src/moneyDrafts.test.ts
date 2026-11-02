import { afterEach, expect, it, vi } from "vitest";
import {
  readMemoryIntent,
  rememberIntent,
  retainActorDraft,
} from "./moneyDrafts";
import { readRecovery, saveRecovery, RECOVERY_KEY } from "./funding";
import { makeQueryClient, replaceActor } from "./session";
afterEach(() => retainActorDraft(null));
const ref = {
  actorId: "A",
  environmentEpoch: "epoch",
  operationType: "TRANSFER" as const,
  key: "11111111-1111-4111-8111-111111111111",
};
const body = {
  destinationWalletId: "22222222-2222-4222-8222-222222222222",
  amount: "10000",
  currency: "VND" as const,
  note: "Private memory note",
};
it("retains exact intent through same-actor reauth, never persists payload and clears on logout/switch", async () => {
  const client = makeQueryClient();
  const session = {
    userId: "A",
    roles: ["INDIVIDUAL"],
    authenticatedAt: "",
    absoluteExpiresAt: "",
  };
  rememberIntent({ ...ref, body });
  saveRecovery(ref);
  await replaceActor(client, session);
  expect(readMemoryIntent(ref)?.body).toEqual(body);
  expect(sessionStorage.getItem(RECOVERY_KEY)).not.toContain(
    "Private memory note",
  );
  expect(readMemoryIntent({ ...ref, environmentEpoch: "other" })).toBeNull();
  expect(readMemoryIntent({ ...ref, key: "other" })).toBeNull();
  await replaceActor(client, { ...session, userId: "B" });
  expect(readMemoryIntent(ref)).toBeNull();
  rememberIntent({ ...ref, body });
  await replaceActor(client, null);
  expect(readMemoryIntent(ref)).toBeNull();
  client.clear();
});
it("reload starts with a reference only, so a missing command cannot automatically resend a lost body", async () => {
  rememberIntent({ ...ref, body });
  saveRecovery(ref);
  vi.resetModules();
  const fresh = await import("./moneyDrafts");
  expect(readRecovery("A", "epoch")).toEqual(ref);
  expect(fresh.readMemoryIntent(ref)).toBeNull();
});
