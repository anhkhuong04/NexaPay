import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function setup(page: Page) {
  const email = `funding-${Date.now()}-${crypto.randomUUID()}@example.test`;
  const credentials = { email, password: "Demo-wallet-2026!" };
  async function post(path: string, body: unknown) {
    const token = await (await page.request.get("/api/v1/auth/csrf")).json();
    return page.request.post(path, {
      headers: { [token.headerName]: token.token },
      data: body,
    });
  }
  expect(
    (
      await post("/api/v1/auth/register", {
        ...credentials,
        displayName: "Funding An",
      })
    ).status(),
  ).toBe(201);
  expect((await post("/api/v1/auth/login", credentials)).status()).toBe(200);
  await page.goto("/app/add-demo-funds");
  await expect(
    page.getByRole("heading", { name: "Nhận tiền demo", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Nhận tiền demo", exact: true }),
  ).toBeEnabled();
  return credentials;
}
async function confirm(page: Page) {
  await page
    .getByRole("button", { name: "Nhận tiền demo", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Xác nhận nhận tiền demo" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Xác nhận cấp tiền", exact: true })
    .click();
}

test("funding review, real balance, identical replay, reload and quota", async ({
  page,
}, info) => {
  await setup(page);
  await confirm(page);
  await expect(
    page.getByRole("heading", { name: "Đã nhận tiền demo", exact: true }),
  ).toBeVisible();
  const reference = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("nexapay.money-recovery")!),
  );
  expect(Object.keys(reference).sort()).toEqual([
    "actorId",
    "environmentEpoch",
    "key",
    "operationType",
  ]);
  const token = await (await page.request.get("/api/v1/auth/csrf")).json();
  const replay = await page.request.post("/api/v1/demo-fundings", {
    headers: {
      [token.headerName]: token.token,
      "Idempotency-Key": reference.key,
    },
    data: { amount: "100000", currency: "VND" },
  });
  expect(replay.status()).toBe(201);
  const receipt = await replay.json();
  await expect(
    page.getByText(receipt.resourceId, { exact: true }),
  ).toBeVisible();
  let posts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/v1/demo-fundings"))
      posts++;
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Đã nhận tiền demo", exact: true }),
  ).toBeVisible();
  expect(posts).toBe(0);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: `test-results/${info.project.name}-funding.png`,
    fullPage: true,
  });
  await page.goto("/app/overview");
  await expect(page.getByTestId("wallet-balance")).toHaveText("100.000 ₫");
  await page.goto("/app/commands");
  await page.getByRole("button", { name: "Xem kết quả", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Đã nhận tiền demo", exact: true }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: `test-results/${info.project.name}-commands.png`,
    fullPage: true,
  });
  await page.goto("/app/add-demo-funds");
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "Bắt đầu thao tác mới" }).click();
    await confirm(page);
    await expect(
      page.getByRole("heading", { name: "Đã nhận tiền demo", exact: true }),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: "Bắt đầu thao tác mới" }).click();
  await expect(
    page.getByText("Đã hết hạn mức hôm nay.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Nhận tiền demo", exact: true }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 320, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("response loss recovers by lookup, reauthentication never automatically resends", async ({
  page,
}) => {
  const credentials = await setup(page);
  let posts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/v1/demo-fundings"))
      posts++;
  });
  await page.route("**/api/v1/demo-fundings", async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("failed");
  });
  await confirm(page);
  await expect(
    page.getByText("Chưa xác định được kết quả.", { exact: false }),
  ).toBeVisible();
  await page.unroute("**/api/v1/demo-fundings");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Đã nhận tiền demo", exact: true }),
  ).toBeVisible();
  expect(posts).toBe(1);
  await page.getByRole("button", { name: "Bắt đầu thao tác mới" }).click();
  await page.context().clearCookies();
  await confirm(page);
  await expect(
    page.getByRole("heading", { name: "Đăng nhập", exact: true }),
  ).toBeVisible();
  await page.getByLabel(/^Email/).fill(credentials.email);
  await page.getByLabel(/^Mật khẩu/).fill(credentials.password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(
    page.getByText("Chưa quan sát được kết quả đã lưu.", { exact: false }),
  ).toBeVisible();
  expect(posts).toBe(2);
  await expect(
    page.getByRole("button", { name: "Thử lại cùng mã" }),
  ).toBeVisible();
  const wallet = await (await page.request.get("/api/v1/wallets/me")).json();
  expect(wallet.availableBalance).toBe("100000");
  const commands = await (await page.request.get("/api/v1/commands")).json();
  expect(commands.items).toHaveLength(1);
  const ref = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("nexapay.money-recovery")!),
  );
  const retry = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/api/v1/demo-fundings"),
  );
  await page.getByRole("button", { name: "Thử lại cùng mã" }).click();
  expect((await retry).headers()["idempotency-key"]).toBe(ref.key);
  await expect(
    page.getByRole("heading", { name: "Đã nhận tiền demo", exact: true }),
  ).toBeVisible();
  expect(posts).toBe(3);
  expect(
    (await (await page.request.get("/api/v1/wallets/me")).json())
      .availableBalance,
  ).toBe("200000");
});
