import { afterEach, expect, it, vi } from "vitest";
import { merchantApi, merchantName, merchantWalletKey } from "./merchant";
afterEach(() => vi.unstubAllGlobals());
it("normalizes names and rejects controls/blank/overlength without changing case", () => {
  expect(merchantName.parse("  Cafe\u0301 Demo  ")).toBe("Café Demo");
  for (const value of [" ", "a".repeat(81), "Bad\nname", "\tDemo"])
    expect(merchantName.safeParse(value).success).toBe(false);
  expect(merchantWalletKey("A", "M")).not.toEqual(merchantWalletKey("B", "M"));
  expect(merchantWalletKey("A", "M")).not.toEqual(merchantWalletKey("A", "N"));
});
it("only treats the authoritative missing-merchant response as not onboarded", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify({ code: "MERCHANT_NOT_FOUND" }), {
      status: 404,
    }),
  );
  expect(await merchantApi.own()).toBeNull();
  for (const [status, code] of [
    [503, "UNAVAILABLE"],
    [404, "NOT_FOUND"],
    [401, "UNAUTHENTICATED"],
  ] as const) {
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ code }), { status }),
    );
    await expect(merchantApi.own()).rejects.toMatchObject({ status, code });
  }
});
