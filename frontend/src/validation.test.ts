import { describe, it, expect } from "vitest";
import { displayName, formatMoney, registerSchema } from "./validation";
import { safeReturnTo } from "./session";

describe("exact money and identity boundaries", () => {
  it("formats integer strings without losing precision", () => {
    expect(formatMoney("9007199254740993")).toBe("9.007.199.254.740.993 ₫");
    expect(formatMoney("0")).toBe("0 ₫");
    for (const value of ["1.5", "01", "-1", "1e3"])
      expect(() => formatMoney(value)).toThrow();
  });
  it("enforces code points and UTF-8 bytes just like the server", () => {
    const input = {
      email: "alice@example.test",
      displayName: "An",
      password: "é".repeat(36),
      confirmPassword: "é".repeat(36),
    };
    expect(registerSchema.safeParse(input).success).toBe(true);
    expect(
      registerSchema.safeParse({
        ...input,
        password: "é".repeat(37),
        confirmPassword: "é".repeat(37),
      }).success,
    ).toBe(false);
    expect(
      registerSchema.safeParse({ ...input, confirmPassword: "wrong" }).success,
    ).toBe(false);
  });
  it("rejects control characters without trimming a valid interior name", () => {
    expect(displayName.parse("  Nguyễn An  ")).toBe("Nguyễn An");
    expect(displayName.safeParse("Nguyễn\nAn").success).toBe(false);
  });
  it("allowlists intended routes", () => {
    expect(safeReturnTo("/app/profile")).toBe("/app/profile");
    expect(safeReturnTo("//evil.test")).toBe("/app/overview");
    expect(safeReturnTo("https://evil.test")).toBe("/app/overview");
  });
});
