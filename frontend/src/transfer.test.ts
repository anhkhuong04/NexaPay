import { expect, it } from "vitest";
import { parseVndInput } from "./transfer";
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
