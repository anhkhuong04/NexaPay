import { expect, it } from "vitest";
import { makeQueryClient, replaceActor } from "./session";
import type { Profile, Session } from "./api";

it("cancels old actor requests and does not repopulate the new account cache", async () => {
  const client = makeQueryClient();
  let resolve!: (profile: Profile) => void;
  const delayed = new Promise<Profile>((r) => {
    resolve = r;
  });
  const pending = client
    .fetchQuery({
      queryKey: ["profile", "A", "personal"],
      queryFn: ({ signal }) => {
        void signal;
        return delayed;
      },
    })
    .catch(() => undefined);
  const session: Session = {
    userId: "B",
    roles: ["INDIVIDUAL"],
    authenticatedAt: "2026-01-01T00:00:00Z",
    absoluteExpiresAt: "2026-01-01T08:00:00Z",
  };
  sessionStorage.setItem("nexapay.recovery", "old-intent");
  sessionStorage.setItem("other-app", "keep");
  await replaceActor(client, session);
  resolve({ id: "A", email: "a@example.test", displayName: "Account A" });
  await pending;
  expect(client.getQueryData(["profile", "A", "personal"])).toBeUndefined();
  expect(client.getQueryData(["session"])).toEqual(session);
  expect(sessionStorage.getItem("nexapay.recovery")).toBeNull();
  expect(sessionStorage.getItem("other-app")).toBe("keep");
  client.clear();
});
