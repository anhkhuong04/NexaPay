import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function post(page: Page, path: string, body: unknown, key?: string) {
  const csrf = await (await page.request.get("/api/v1/auth/csrf")).json();
  return page.request.post("/api/v1" + path, {
    headers: {
      [csrf.headerName]: csrf.token,
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    data: body,
  });
}
async function account(page: Page) {
  const body = {
    email: `merchant-${crypto.randomUUID()}@example.test`,
    password: "Demo-wallet-2026!",
    displayName: "An Merchant",
  };
  expect((await post(page, "/auth/register", body)).status()).toBe(201);
  expect(
    (
      await post(page, "/auth/login", {
        email: body.email,
        password: body.password,
      })
    ).status(),
  ).toBe(200);
  return body;
}
const switcher = (page: Page) =>
  page.getByRole("navigation", { name: "Không gian làm việc" });
async function scan(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    ),
  );
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
}
async function onboard(page: Page, name = "Cửa hàng Demo") {
  await page.goto("/business/onboarding");
  await page.getByLabel(/^Tên doanh nghiệp/).fill(name);
  await page
    .getByRole("button", { name: "Tạo doanh nghiệp", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("merchant-balance")).toHaveText("0 ₫");
  return (await (await page.request.get("/api/v1/merchants/me")).json())
    .id as string;
}
test("merchant onboarding keeps personal funds separate and persists owner profile across workspaces", async ({
  page,
}, info) => {
  const credentials = await account(page);
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
  const personal = await (await page.request.get("/api/v1/wallets/me")).json();
  await switcher(page)
    .getByRole("link", { name: "Doanh nghiệp", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Mở không gian doanh nghiệp",
      exact: true,
    }),
  ).toBeVisible();
  await scan(page);
  await page.getByLabel(/^Tên doanh nghiệp/).fill("  Cafe\u0301 mô phỏng  ");
  await page
    .getByRole("button", { name: "Tạo doanh nghiệp", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Café mô phỏng", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("merchant-balance")).toHaveText("0 ₫");
  const merchant = await (
    await page.request.get("/api/v1/merchants/me")
  ).json();
  const wallet = await (
    await page.request.get(`/api/v1/merchants/${merchant.id}/wallet`)
  ).json();
  expect(wallet.id).not.toBe(personal.id);
  expect(
    (await post(page, "/merchants", { displayName: "Duplicate" })).status(),
  ).toBe(409);
  const session = await (await page.request.get("/api/v1/auth/session")).json();
  expect(session.merchantId).toBe(merchant.id);
  expect(session.roles).toContain("MERCHANT");
  expect(session.roles).not.toContain("ADMIN");
  await expect(
    page.getByRole("link", { name: "Tạo yêu cầu thanh toán", exact: true }),
  ).toHaveAttribute("href", "/business/payment-requests/new");
  await scan(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `test-results/${info.project.name}-business-overview.png`,
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "Chỉnh sửa tên doanh nghiệp", exact: true })
    .click();
  const longName = "Cửa hàng ".repeat(8).trim();
  await page.getByLabel(/^Tên doanh nghiệp/).fill(longName);
  await page
    .getByRole("button", { name: "Lưu tên doanh nghiệp", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Đã lưu tên doanh nghiệp",
  );
  await page.reload();
  await expect(page.getByLabel(/^Tên doanh nghiệp/)).toHaveValue(longName);
  await scan(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `test-results/${info.project.name}-business-settings.png`,
    fullPage: true,
  });
  await switcher(page)
    .getByRole("link", { name: "Ví cá nhân", exact: true })
    .click();
  await expect(page.getByTestId("wallet-balance")).toHaveText("100.000 ₫");
  expect((await (await page.request.get("/api/v1/wallets/me")).json()).id).toBe(
    personal.id,
  );
  await switcher(page)
    .getByRole("link", { name: "Doanh nghiệp", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: longName, exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("merchant-balance")).toHaveText("0 ₫");
  if (info.project.name === "desktop") {
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: "test-results/desktop-business-zoom200.png",
      fullPage: true,
    });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "";
    });
  }
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
  await page.getByLabel(/^Email/).fill(credentials.email);
  await page.getByLabel(/^Mật khẩu/).fill(credentials.password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByTestId("wallet-balance")).toHaveText("100.000 ₫");
  await switcher(page)
    .getByRole("link", { name: "Doanh nghiệp", exact: true })
    .click();
  await expect(page.getByTestId("merchant-balance")).toHaveText("0 ₫");
});
test("lost onboarding response recovers once; business wallet pending error and locked views stay honest", async ({
  page,
}, info) => {
  await account(page);
  let posts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/v1/merchants")) posts++;
  });
  await page.route("**/api/v1/merchants", async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("failed");
  });
  await page.goto("/business/onboarding");
  await page.getByLabel(/^Tên doanh nghiệp/).fill("Response loss demo");
  await page
    .getByRole("button", { name: "Tạo doanh nghiệp", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Chưa xác định được kết quả",
  );
  expect(posts).toBe(1);
  await expect(page.getByLabel(/^Tên doanh nghiệp/)).toBeDisabled();
  await page.unroute("**/api/v1/merchants");
  await page
    .getByRole("button", { name: "Kiểm tra doanh nghiệp đã tạo" })
    .click();
  await expect(page.getByTestId("merchant-balance")).toHaveText("0 ₫");
  expect(posts).toBe(1);
  const url = "**/api/v1/merchants/*/wallet";
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route(url, async (route) => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await page.reload();
  try {
    await expect(
      page.getByText("Đang tải ví doanh nghiệp…", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("merchant-balance")).toHaveCount(0);
  } finally {
    release();
  }
  await expect(page.getByTestId("merchant-balance")).toHaveText("0 ₫");
  await page.unroute(url);
  await page.route(url, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        code: "UNAVAILABLE",
        message: "Chưa thể tải ví doanh nghiệp.",
      }),
    }),
  );
  await page
    .getByRole("button", { name: "Tải lại ví doanh nghiệp", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Chưa thể tải ví doanh nghiệp.",
  );
  await expect(page.getByTestId("merchant-balance")).toHaveCount(0);
  await page.unroute(url);
  // Controlled GET fixture tests only UI status; no database status or balance is modified.
  await page.route(url, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), status: "LOCKED" },
    });
  });
  await page.getByRole("button", { name: "Thử lại", exact: true }).click();
  await expect(page.getByText(/Ví doanh nghiệp bị khóa/)).toBeVisible();
  await scan(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `test-results/${info.project.name}-business-locked-fixture.png`,
    fullPage: true,
  });
  await page.unroute(url);
  await page.reload();
  await expect(page.getByTestId("merchant-balance")).toHaveText("0 ₫");
  expect(posts).toBe(1);
});
test("business mutation reauth and account switching enforce real membership rather than cached roles", async ({
  page,
}) => {
  const a = await account(page);
  const id = await onboard(page, "Private Merchant A");
  await page.goto("/business/settings");
  await page.getByLabel(/^Tên doanh nghiệp/).fill("Session loss rename");
  await page.context().clearCookies();
  await page
    .getByRole("button", { name: "Lưu tên doanh nghiệp", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Đăng nhập", exact: true }),
  ).toBeVisible();
  await page.getByLabel(/^Email/).fill(a.email);
  await page.getByLabel(/^Mật khẩu/).fill(a.password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByLabel(/^Tên doanh nghiệp/)).toHaveValue(
    "Private Merchant A",
  );
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Đăng nhập", exact: true }),
  ).toBeVisible();
  await account(page);
  expect((await page.request.get(`/api/v1/merchants/${id}`)).status()).toBe(
    404,
  );
  expect(
    (await page.request.get(`/api/v1/merchants/${id}/wallet`)).status(),
  ).toBe(404);
  const csrf = await (await page.request.get("/api/v1/auth/csrf")).json();
  expect(
    (
      await page.request.patch(`/api/v1/merchants/${id}`, {
        headers: { [csrf.headerName]: csrf.token },
        data: { displayName: "Not owner" },
      })
    ).status(),
  ).toBe(404);
  await page.goto("/business/overview");
  await expect(
    page.getByRole("heading", {
      name: "Bạn chưa có doanh nghiệp",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Private Merchant A", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByTestId("merchant-balance")).toHaveCount(0);
  await page
    .getByRole("link", { name: "Mở doanh nghiệp demo", exact: true })
    .click();
  await expect(page.getByLabel(/^Tên doanh nghiệp/)).toHaveValue("");
});
