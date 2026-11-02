import { afterEach, expect, it, vi } from "vitest";
import { parseVndInput, transferApi } from "./transfer";
it("parses exact vi-VN integer grouping without rounding or ambiguous stripping", () => {
  for (const [input, expected] of [
    ["1", "1"],
    ["10000", "10000"],
    ["10.000", "10000"],
    ["100.000.000", "100000000"],
    [" 1.000 ", "1000"],
  ])
    expect(parseVndInput(input!, "1", "100000000")).toBe(expected);
  for (const input of [
    "0",
    "01",
    "1.0",
    "1,000",
    "1.000,00",
    "1e4",
    "10.00",
    "100000001",
    "-1",
    "+1",
    "1 000",
    "9223372036854775808",
    "",
  ])
    expect(() => parseVndInput(input, "1", "100000000")).toThrow();
});

afterEach(() => vi.unstubAllGlobals());
it("requests five recent records without changing the history default page size", async () => {
  const fetch = vi
    .fn()
    .mockImplementation(
      async () => new Response(JSON.stringify({ items: [], nextCursor: null })),
    );
  vi.stubGlobal("fetch", fetch);
  const filter = { type: "", status: "", from: "", to: "" };
  await transferApi.history(filter, undefined, undefined, 5);
  expect(fetch.mock.calls[0][0]).toBe("/api/v1/transactions?limit=5");
  await transferApi.history(filter);
  expect(fetch.mock.calls[1][0]).toBe("/api/v1/transactions?limit=20");
});
