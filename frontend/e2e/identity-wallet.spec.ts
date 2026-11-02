import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("real signup, sign-in, wallet, profile, refresh and logout", async ({
  page,
}, info) => {
  const email = `demo-${Date.now()}-${info.project.name}@example.test`;
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Ví của bạn/ })).toBeVisible();
  await page.screenshot({
    path: `test-results/${info.project.name}-landing.png`,
    fullPage: true,
  });
  await page.getByRole("link", { name: "Tạo ví demo", exact: true }).click();
  await page.getByLabel(/^Tên hiển thị/).fill("Nguyễn An");
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Mật khẩu/).fill("Demo-wallet-2026!");
  await page.getByLabel(/^Xác nhận mật khẩu/).fill("Demo-wallet-2026!");
  await page.screenshot({
    path: `test-results/${info.project.name}-signup.png`,
    fullPage: true,
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page
    .getByRole("button", { name: "Tạo tài khoản demo", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Đăng nhập", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Đã tạo ví demo");
  await page.getByLabel(/^Mật khẩu/).fill("Demo-wallet-2026!");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByTestId("wallet-balance")).toHaveText("0 ₫");
  await expect(
    page.getByRole("heading", { name: "Chào Nguyễn An." }),
  ).toBeVisible();
  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === "JSESSIONID");
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");
  await page.reload();
  await expect(page.getByTestId("wallet-balance")).toHaveText("0 ₫");
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: `test-results/${info.project.name}-wallet.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  // Delay a real wallet response: a pending request must never invent a zero balance.
  let releaseWallet!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseWallet = resolve;
  });
  await page.route("**/api/v1/wallets/me", async (route) => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await page.reload();
  try {
    await expect(
      page.getByText("Đang tải số dư ví…", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("wallet-balance")).toHaveCount(0);
  } finally {
    releaseWallet();
  }
  await expect(page.getByTestId("wallet-balance")).toHaveText("0 ₫");
  await page.unroute("**/api/v1/wallets/me");
  await page.route("**/api/v1/wallets/me", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        code: "UNAVAILABLE",
        message: "Chưa thể tải ví.",
      }),
    }),
  );
  await page.getByRole("button", { name: "Tải lại", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Chưa thể tải ví.");
  await expect(page.getByTestId("wallet-balance")).toHaveCount(0);
  await page.unroute("**/api/v1/wallets/me");
  await page.getByRole("button", { name: "Thử lại", exact: true }).click();
  await expect(page.getByTestId("wallet-balance")).toHaveText("0 ₫");
  await page.getByRole("link", { name: "Hồ sơ của tôi", exact: true }).click();
  await expect(page.getByLabel(/^Email/)).toHaveAttribute("readonly");
  await page.getByLabel(/^Tên hiển thị/).fill("An NexaPay");
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(page.getByRole("status")).toContainText("Đã lưu");
  await page.reload();
  await expect(page.getByLabel(/^Tên hiển thị/)).toHaveValue("An NexaPay");
  await page.screenshot({
    path: `test-results/${info.project.name}-profile.png`,
    fullPage: true,
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.setViewportSize({ width: 320, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  // Lose the server session while editing: the mutation's 401 must return to sign-in.
  await page.context().clearCookies();
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(
    page.getByRole("heading", { name: "Đăng nhập", exact: true }),
  ).toBeVisible();
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Mật khẩu/).fill("Demo-wallet-2026!");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByLabel(/^Tên hiển thị/)).toHaveValue("An NexaPay");
  await page.getByRole("link", { name: "Tổng quan", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Chào An NexaPay." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await page.goto("/app/overview");
  await expect(
    page.getByRole("heading", { name: "Đăng nhập", exact: true }),
  ).toBeVisible();
});

test("session loss, API errors, keyboard and reflow remain honest", async ({
  page,
}, info) => {
  await page.goto("/auth/sign-in");
  await expect(
    page.getByRole("heading", { name: "Đăng nhập", exact: true }),
  ).toBeVisible();
  await page.getByLabel(/^Email/).fill(`missing-${Date.now()}@example.test`);
  await page.getByLabel(/^Mật khẩu/).fill("Wrong-demo-password");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Email hoặc mật khẩu");
  await page.getByLabel(/^Mật khẩu/).focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Hiện mật khẩu" }),
  ).toBeFocused();
  await page.setViewportSize({ width: 320, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${info.project.name}-error-reflow.png`,
    fullPage: true,
  });
  const unknown = await page.request.get("/api/v1/unknown");
  expect(unknown.status()).toBe(401);
  expect(unknown.headers()["content-type"]).toContain("application/json");
});
