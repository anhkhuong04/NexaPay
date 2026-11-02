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
  await page.getByLabel("Tên hiển thị", { exact: true }).fill("Nguyễn An");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("Demo-wallet-2026!");
  await page
    .getByLabel("Xác nhận mật khẩu", { exact: true })
    .fill("Demo-wallet-2026!");
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
  await page.getByLabel("Mật khẩu", { exact: true }).fill("Demo-wallet-2026!");
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
  await page.getByRole("link", { name: "Hồ sơ của tôi", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute(
    "readonly",
  );
  await page.getByLabel("Tên hiển thị", { exact: true }).fill("An NexaPay");
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(page.getByRole("status")).toContainText("Đã lưu");
  await page.reload();
  await expect(page.getByLabel("Tên hiển thị", { exact: true })).toHaveValue(
    "An NexaPay",
  );
  await page.screenshot({
    path: `test-results/${info.project.name}-profile.png`,
    fullPage: true,
  });
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
  await page
    .getByLabel("Email", { exact: true })
    .fill(`missing-${Date.now()}@example.test`);
  await page
    .getByLabel("Mật khẩu", { exact: true })
    .fill("Wrong-demo-password");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Email hoặc mật khẩu");
  await page.getByLabel("Mật khẩu", { exact: true }).focus();
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
