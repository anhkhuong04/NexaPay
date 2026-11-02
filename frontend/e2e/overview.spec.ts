import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function post(page: Page, path: string, body: unknown, key?: string) {
  const csrf = await (await page.request.get("/api/v1/auth/csrf")).json();
  return page.request.post(`/api/v1${path}`, {
    headers: {
      [csrf.headerName]: csrf.token,
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    data: body,
  });
}
async function account(page: Page, name: string) {
  const credentials = {
    email: `overview-${crypto.randomUUID()}@example.test`,
    password: "Demo-wallet-2026!",
  };
  expect(
    (
      await post(page, "/auth/register", { ...credentials, displayName: name })
    ).status(),
  ).toBe(201);
  expect((await post(page, "/auth/login", credentials)).status()).toBe(200);
  const wallet = await (await page.request.get("/api/v1/wallets/me")).json();
  return { credentials, wallet };
}
async function funded(page: Page) {
  const a = await account(page, "An Overview");
  expect(
    (
      await post(
        page,
        "/demo-fundings",
        { amount: "100000", currency: "VND" },
        crypto.randomUUID(),
      )
    ).status(),
  ).toBe(201);
  await page.goto("/app/overview");
  await expect(page.getByTestId("wallet-balance")).toHaveText("100.000 ₫");
  return a;
}
const recent = (page: Page) =>
  page.getByRole("region", { name: "Giao dịch gần đây" });
const actions = (page: Page) =>
  page.getByRole("region", { name: "Thao tác ví" });
async function scan(page: Page) {
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
}
async function review(page: Page, destination: string, amount = "10000") {
  await actions(page)
    .getByRole("button", { name: "Chuyển tiền", exact: true })
    .click();
  await page.getByLabel(/^Mã ví người nhận/).fill(destination);
  await page
    .getByRole("button", { name: "Tra cứu người nhận", exact: true })
    .click();
  await expect(page.getByText(destination, { exact: true })).toBeVisible();
  await page.getByLabel(/^Số tiền/).fill(amount);
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Xác nhận chuyển tiền" }),
  ).toBeVisible();
}
test("overview shows real funding/P2P, newest five, rejected intent and actor-owned incoming", async ({
  page,
}, info) => {
  const b = await account(page, "Bình ".repeat(12).trim());
  expect((await post(page, "/auth/logout", {})).status()).toBe(204);
  await account(page, "An Overview");
  const urls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/v1/transactions?")) urls.push(r.url());
  });
  await page.goto("/app/overview");
  await expect(recent(page).getByText("Bạn chưa có giao dịch.")).toBeVisible();
  await actions(page)
    .getByRole("button", { name: "Nhận tiền demo", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Nhận tiền demo", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Xác nhận cấp tiền", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Đã nhận tiền demo", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Ví cá nhân" })
    .getByRole("link", { name: "Tổng quan", exact: true })
    .click();
  await expect(recent(page).getByRole("article")).toHaveCount(1);
  await expect(
    recent(page).getByText("+100.000 ₫", { exact: true }),
  ).toBeVisible();
  await review(page, b.wallet.id);
  const committed = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" && r.url().endsWith("/api/v1/transfers"),
  );
  await page
    .getByRole("button", { name: "Xác nhận chuyển", exact: true })
    .click();
  const first = await (await committed).json();
  await expect(
    page.getByRole("heading", { name: "Đã chuyển tiền", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Ví cá nhân" })
    .getByRole("link", { name: "Tổng quan", exact: true })
    .click();
  await expect(page.getByTestId("wallet-balance")).toHaveText("90.000 ₫");
  await expect(recent(page).getByRole("article")).toHaveCount(2);
  await expect(
    recent(page).getByText("−10.000 ₫", { exact: true }),
  ).toBeVisible();
  const ids: string[] = [first.resourceId];
  for (let i = 0; i < 4; i++) {
    const response = await post(
      page,
      "/transfers",
      {
        destinationWalletId: b.wallet.id,
        amount: "1",
        currency: "VND",
        note: "Overview pagination",
      },
      crypto.randomUUID(),
    );
    expect(response.status()).toBe(201);
    ids.push((await response.json()).resourceId);
  }
  await page.getByRole("button", { name: "Tải lại", exact: true }).click();
  await expect(page.getByTestId("wallet-balance")).toHaveText("89.996 ₫");
  await expect(recent(page).getByRole("article")).toHaveCount(5);
  const links = await recent(page)
    .getByRole("link", { name: /Xem chi tiết giao dịch/ })
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")));
  expect(links).toEqual(
    [...ids].reverse().map((id) => `/app/transactions/TRANSFER/${id}`),
  );
  expect(
    urls.some((url) => new URL(url).searchParams.get("limit") === "5"),
  ).toBe(true);
  await recent(page).getByRole("link", { name: "Xem toàn bộ lịch sử" }).click();
  await expect(page.getByRole("article")).toHaveCount(6);
  expect(
    urls.some((url) => new URL(url).searchParams.get("limit") === "20"),
  ).toBe(true);
  const rejected = await post(
    page,
    "/transfers",
    {
      destinationWalletId: b.wallet.id,
      amount: "1000000",
      currency: "VND",
      note: "Insufficient overview",
    },
    crypto.randomUUID(),
  );
  expect(rejected.status()).toBe(422);
  await page
    .getByRole("navigation", { name: "Ví cá nhân" })
    .getByRole("link", { name: "Tổng quan", exact: true })
    .click();
  await page.getByRole("button", { name: "Tải lại", exact: true }).click();
  await expect(
    recent(page).getByText("Không trừ tiền", { exact: true }),
  ).toBeVisible();
  await expect(
    recent(page).getByText("1.000.000 ₫", { exact: true }),
  ).toBeVisible();
  await expect(
    recent(page).getByText("−1.000.000 ₫", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByTestId("wallet-balance")).toHaveText("89.996 ₫");
  await scan(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `test-results/${info.project.name}-overview-recent.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Đăng nhập", exact: true }),
  ).toBeVisible();
  await page.getByLabel(/^Email/).fill(b.credentials.email);
  await page.getByLabel(/^Mật khẩu/).fill(b.credentials.password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByTestId("wallet-balance")).toHaveText("10.004 ₫");
  await expect(recent(page).getByRole("article")).toHaveCount(5);
  await expect(
    recent(page).getByText("+10.000 ₫", { exact: true }),
  ).toBeVisible();
  await expect(
    recent(page).getByText("Không trừ tiền", { exact: true }),
  ).toHaveCount(0);
  await expect(
    recent(page).getByText("+100.000 ₫", { exact: true }),
  ).toHaveCount(0);
});
test("overview isolates wallet/activity failures, pending state and controlled locked-wallet UI", async ({
  page,
}, info) => {
  const a = await funded(page);
  await expect(recent(page).getByRole("article")).toHaveCount(1);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/v1/transactions?**", async (route) => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await page.reload();
  try {
    await expect(
      recent(page).getByText("Đang tải giao dịch gần đây…"),
    ).toBeVisible();
    await expect(recent(page).getByRole("article")).toHaveCount(0);
    await expect(recent(page).getByText("Bạn chưa có giao dịch.")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("wallet-balance")).toHaveText("100.000 ₫");
  } finally {
    release();
  }
  await expect(recent(page).getByRole("article")).toHaveCount(1);
  await page.unroute("**/api/v1/transactions?**");
  await page.route("**/api/v1/transactions?**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        code: "UNAVAILABLE",
        message: "Activity temporarily unavailable.",
      }),
    }),
  );
  await page.getByRole("button", { name: "Tải lại", exact: true }).click();
  await expect(recent(page).getByRole("alert")).toContainText(
    "Activity temporarily unavailable.",
  );
  await expect(recent(page).getByRole("article")).toHaveCount(0);
  await expect(page.getByTestId("wallet-balance")).toHaveText("100.000 ₫");
  await page.unroute("**/api/v1/transactions?**");
  await recent(page)
    .getByRole("button", { name: "Thử lại", exact: true })
    .click();
  await expect(recent(page).getByRole("article")).toHaveCount(1);
  await page.route("**/api/v1/wallets/me", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        code: "UNAVAILABLE",
        message: "Wallet temporarily unavailable.",
      }),
    }),
  );
  await page.getByRole("button", { name: "Tải lại", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Wallet temporarily unavailable.",
  );
  await expect(page.getByTestId("wallet-balance")).toHaveCount(0);
  await expect(recent(page).getByRole("article")).toHaveCount(1);
  await expect(
    actions(page).getByRole("button", { name: "Chuyển tiền", exact: true }),
  ).toBeDisabled();
  await page.unroute("**/api/v1/wallets/me");
  // Controlled GET fixture tests LOCKED presentation only; it does not mutate DB status/money.
  await page.route("**/api/v1/wallets/me", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...a.wallet,
        availableBalance: "100000",
        totalBalance: "100000",
        status: "LOCKED",
      }),
    }),
  );
  await page.getByRole("button", { name: "Thử lại", exact: true }).click();
  await expect(actions(page).getByRole("alert")).toContainText(
    "Ví đang bị khóa",
  );
  await expect(
    actions(page).getByRole("button", { name: "Chuyển tiền", exact: true }),
  ).toBeDisabled();
  await expect(
    actions(page).getByRole("button", { name: "Nhận tiền demo", exact: true }),
  ).toBeDisabled();
  await expect(
    actions(page).getByRole("link", { name: "Lịch sử giao dịch", exact: true }),
  ).toHaveAttribute("href", "/app/transactions");
  await expect(
    actions(page).getByRole("link", { name: "Thao tác đã lưu", exact: true }),
  ).toHaveAttribute("href", "/app/commands");
  await scan(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `test-results/${info.project.name}-overview-locked-fixture.png`,
    fullPage: true,
  });
  await page.unroute("**/api/v1/wallets/me");
  await page.getByRole("button", { name: "Tải lại", exact: true }).click();
  await expect(
    actions(page).getByRole("button", { name: "Chuyển tiền", exact: true }),
  ).toBeEnabled();
});
test("late committed response refreshes Overview balance and recent activity after navigation", async ({
  page,
}) => {
  const b = await account(page, "Bình Overview");
  expect((await post(page, "/auth/logout", {})).status()).toBe(204);
  await funded(page);
  await expect(recent(page).getByRole("article")).toHaveCount(1);
  await review(page, b.wallet.id, "1000");
  let release!: () => void;
  let accepted!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const committed = new Promise<void>((r) => (accepted = r));
  await page.route("**/api/v1/transfers", async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    accepted();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page
      .getByRole("button", { name: "Xác nhận chuyển", exact: true })
      .click();
    await committed;
    await page
      .getByRole("navigation", { name: "Ví cá nhân" })
      .getByRole("link", { name: "Tổng quan", exact: true })
      .click();
    await expect(recent(page).getByRole("article")).toHaveCount(1);
    release();
    await expect(page.getByTestId("wallet-balance")).toHaveText("99.000 ₫");
    await expect(recent(page).getByRole("article")).toHaveCount(2);
    await expect(
      recent(page).getByText("−1.000 ₫", { exact: true }),
    ).toBeVisible();
  } finally {
    release();
  }
});
