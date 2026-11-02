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
    email: `payment-${crypto.randomUUID()}@example.test`,
    password: "Demo-wallet-2026!",
  };
  expect(
    (
      await post(page, "/auth/register", { ...credentials, displayName: name })
    ).status(),
  ).toBe(201);
  expect((await post(page, "/auth/login", credentials)).status()).toBe(200);
  return credentials;
}
async function owner(page: Page) {
  const credentials = await account(page, "Merchant Owner");
  const response = await post(page, "/merchants", { displayName: "Café Demo" });
  expect(response.status()).toBe(201);
  return { credentials, merchant: await response.json() };
}
async function request(page: Page, merchant: string, amount = "10000") {
  const response = await post(
    page,
    `/merchants/${merchant}/payment-requests`,
    {
      amount,
      currency: "VND",
      description: "Coffee payment",
      expiryMinutes: 30,
    },
    crypto.randomUUID(),
  );
  expect(response.status()).toBe(201);
  return response.json();
}
async function fund(page: Page) {
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
}
async function logout(page: Page) {
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Đăng nhập", exact: true }),
  ).toBeVisible();
}
async function login(
  page: Page,
  credentials: { email: string; password: string },
) {
  await page.getByLabel(/^Email/).fill(credentials.email);
  await page.getByLabel(/^Mật khẩu/).fill(credentials.password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
}
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

async function fixture(page: Page) {
  const o = await owner(page);
  const req = await request(page, o.merchant.id);
  expect((await post(page, "/auth/logout", {})).status()).toBe(204);
  const payer = await account(page, "Refund payer");
  await fund(page);
  const paid = await post(
    page,
    `/checkout/${req.publicRef}/pay`,
    { amount: "10000", currency: "VND" },
    crypto.randomUUID(),
  );
  expect(paid.status()).toBe(201);
  const payment = (await paid.json()).result.paymentId as string;
  expect((await post(page, "/auth/login", o.credentials)).status()).toBe(200);
  return {
    ...o,
    payer,
    req,
    payment,
    path: `/business/payments/${payment}/refund`,
    endpoint: `/api/v1/merchants/${o.merchant.id}/payments/${payment}/refunds`,
  };
}
async function review(page: Page, amount = "3000") {
  await page.getByLabel(/^Số tiền hoàn/).fill(amount);
  await page.getByLabel(/^Lý do hoàn tiền/).fill("  Cafe\u0301 refund  ");
  await page
    .getByRole("button", { name: "Xem lại hoàn tiền", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Xác nhận hoàn tiền", exact: true }),
  ).toBeVisible();
}
async function confirm(page: Page) {
  await page
    .getByRole("button", { name: "Xác nhận hoàn tiền", exact: true })
    .focus();
  await page.keyboard.press("Enter");
}

test("partial and full refunds retain PAID, update merchant totals and original payer incoming history", async ({
  page,
}, info) => {
  const f = await fixture(page);
  let sends = 0;
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      r.url().endsWith(`/payments/${f.payment}/refunds`)
    )
      sends++;
  });
  await page.goto(`/business/payment-requests/${f.req.id}`);
  await page
    .getByRole("main")
    .getByRole("link", { name: "Hoàn tiền", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(f.path + "$"));
  await review(page);
  expect(sends).toBe(0);
  await scan(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `test-results/${info.project.name}-refund-review.png`,
    fullPage: true,
  });
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: 320, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `test-results/${info.project.name}-refund-320.png`,
    fullPage: true,
  });
  await page.setViewportSize(viewport);
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
      path: "test-results/desktop-refund-zoom200.png",
      fullPage: true,
    });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "";
    });
  }
  await confirm(page);
  await expect(
    page.getByRole("heading", { name: "Đã hoàn tiền", exact: true }),
  ).toBeVisible();
  expect(sends).toBe(1);
  const capture = await (
    await page.request.get(
      `/api/v1/merchants/${f.merchant.id}/payments/${f.payment}`,
    )
  ).json();
  expect(capture.refundStatus).toBe("PARTIAL");
  expect(capture.refundedAmount).toBe("3000");
  expect(capture.refundableAmount).toBe("7000");
  await page.getByRole("link", { name: "Xem chi tiết", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Chi tiết hoàn tiền", exact: true }),
  ).toBeVisible();
  await scan(page);
  await page
    .getByRole("link", {
      name: "Xem thanh toán và phần còn được hoàn",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Bắt đầu hoàn tiền mới", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Hoàn toàn bộ phần còn lại", exact: true })
    .click();
  await expect(page.getByLabel(/^Số tiền hoàn/)).toHaveValue("7000");
  await page
    .getByRole("button", { name: "Xem lại hoàn tiền", exact: true })
    .click();
  await confirm(page);
  await expect(
    page.getByRole("heading", { name: "Đã hoàn tiền", exact: true }),
  ).toBeVisible();
  expect(sends).toBe(2);
  const full = await (
    await page.request.get(
      `/api/v1/merchants/${f.merchant.id}/payments/${f.payment}`,
    )
  ).json();
  expect(full.refundStatus).toBe("FULL");
  expect(full.refundedAmount).toBe("10000");
  expect(
    (
      await (
        await page.request.get(
          `/api/v1/merchants/${f.merchant.id}/payment-requests/${f.req.id}`,
        )
      ).json()
    ).status,
  ).toBe("PAID");
  await page.goto("/business/overview");
  await expect(page.getByTestId("merchant-balance")).toHaveText("0 ₫");
  const summary = await (
    await page.request.get(
      `/api/v1/merchants/${f.merchant.id}/payments/summary`,
    )
  ).json();
  expect(summary.refundsToday).toBe(2);
  expect(summary.refundedToday).toBe("10000");
  expect(summary.receivedToday).toBe("10000");
  await page.goto("/business/refunds");
  await page
    .getByLabel("Trạng thái hoàn tiền", { exact: true })
    .selectOption("SUCCEEDED");
  await expect(
    page.getByRole("link", { name: "Xem hoàn tiền", exact: true }),
  ).toHaveCount(2);
  await scan(page);
  await logout(page);
  await login(page, f.payer);
  await expect(page.getByTestId("wallet-balance")).toHaveText("100.000 ₫");
  await expect(
    page
      .getByRole("region", { name: "Giao dịch gần đây" })
      .getByText("Nhận hoàn tiền", { exact: true }),
  ).toHaveCount(2);
  await page.goto("/app/transactions");
  await page
    .getByRole("link", { name: "Xem chi tiết", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/app\/transactions\/REFUND\/[0-9a-f-]+$/);
  await expect(
    page.getByRole("heading", { name: "Chi tiết giao dịch", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Nhận hoàn tiền", exact: true }),
  ).toBeVisible();
  expect(
    (
      await page.request.get(`/api/v1/merchants/${f.merchant.id}/refunds`)
    ).status(),
  ).toBe(404);
  await scan(page);
});

test("committed refund response loss recovers across funding and reload without another POST", async ({
  page,
}) => {
  const f = await fixture(page);
  const keys: string[] = [];
  await page.route(f.endpoint, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"]);
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("failed");
  });
  await page.goto(f.path);
  await review(page, "4000");
  await confirm(page);
  await expect(
    page.getByRole("button", { name: "Kiểm tra trạng thái", exact: true }),
  ).toBeVisible();
  expect(keys).toHaveLength(1);
  const stored = await page.evaluate(() =>
    sessionStorage.getItem("nexapay.money-recovery"),
  );
  expect(stored).not.toContain("4000");
  expect(stored).not.toContain("Café");
  await page.unroute(f.endpoint);
  await page.goto("/app/add-demo-funds");
  await expect(
    page.getByRole("heading", { name: "Đã hoàn tiền", exact: true }),
  ).toBeVisible();
  await page.goto(f.path);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Đã hoàn tiền", exact: true }),
  ).toBeVisible();
  expect(keys).toHaveLength(1);
  const lookup = await (
    await page.request.get(`/api/v1/commands/REFUND/${keys[0]}`)
  ).json();
  const repeat = await post(
    page,
    `/merchants/${f.merchant.id}/payments/${f.payment}/refunds`,
    { amount: "4000", currency: "VND", note: "Café refund" },
    keys[0],
  );
  expect(repeat.status()).toBe(201);
  expect(await repeat.json()).toEqual(lookup);
  expect(
    (
      await (
        await page.request.get(`/api/v1/merchants/${f.merchant.id}/wallet`)
      ).json()
    ).availableBalance,
  ).toBe("6000");
});

test("refund reauth looks up first and only manually retries the original key", async ({
  page,
}) => {
  const f = await fixture(page);
  const keys: string[] = [];
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      r.url().endsWith(`/payments/${f.payment}/refunds`)
    )
      keys.push(r.headers()["idempotency-key"]);
  });
  await page.goto(f.path);
  await review(page, "2500");
  await page.context().clearCookies();
  await confirm(page);
  await expect(
    page.getByRole("heading", { name: "Đăng nhập", exact: true }),
  ).toBeVisible();
  await expect.poll(() => keys.length).toBe(1);
  await login(page, f.credentials);
  await expect(page).toHaveURL(new RegExp(f.path + "$"));
  await expect(
    page.getByRole("button", { name: "Thử lại cùng mã", exact: true }),
  ).toBeVisible();
  expect(keys).toHaveLength(1);
  await page
    .getByRole("button", { name: "Thử lại cùng mã", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Đã hoàn tiền", exact: true }),
  ).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});

test("late committed refund response refreshes Business Overview after leaving the form", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto(f.path);
  await page
    .getByRole("link", { name: "Tổng quan doanh nghiệp", exact: true })
    .click();
  await expect(page.getByTestId("merchant-balance")).toHaveText("10.000 ₫");
  await page.goBack();
  await review(page, "1000");
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let captured = false;
  await page.route(f.endpoint, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    captured = true;
    await held;
    await route.fulfill({ response });
  });
  try {
    await confirm(page);
    await expect.poll(() => captured).toBe(true);
    await page
      .getByRole("link", { name: "Tổng quan doanh nghiệp", exact: true })
      .click();
    await expect(page.getByTestId("merchant-balance")).toHaveText("10.000 ₫");
    release();
    await expect(page.getByTestId("merchant-balance")).toHaveText("9.000 ₫");
  } finally {
    release();
  }
});
