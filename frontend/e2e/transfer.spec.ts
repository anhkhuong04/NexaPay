import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function post(page: Page, path: string, body: unknown, key?: string) {
  const token = await (await page.request.get("/api/v1/auth/csrf")).json();
  return page.request.post(`/api/v1${path}`, {
    headers: {
      [token.headerName]: token.token,
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    data: body,
  });
}
async function setup(page: Page) {
  const recipient = {
    email: `recipient-${crypto.randomUUID()}@example.test`,
    password: "Demo-wallet-2026!",
  };
  const sender = {
    email: `sender-${crypto.randomUUID()}@example.test`,
    password: "Demo-wallet-2026!",
  };
  expect(
    (
      await post(page, "/auth/register", {
        ...recipient,
        displayName: "Bình nhận",
      })
    ).status(),
  ).toBe(201);
  expect((await post(page, "/auth/login", recipient)).status()).toBe(200);
  const destination = await (
    await page.request.get("/api/v1/wallets/me")
  ).json();
  expect((await post(page, "/auth/logout", {})).status()).toBe(204);
  expect(
    (
      await post(page, "/auth/register", {
        ...sender,
        displayName: "An chuyển",
      })
    ).status(),
  ).toBe(201);
  expect((await post(page, "/auth/login", sender)).status()).toBe(200);
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
  await page.goto("/app/send");
  await expect(
    page.getByRole("heading", { name: "Chuyển tiền", exact: true }),
  ).toBeVisible();
  return { sender, recipient, destination };
}
async function review(page: Page, walletId: string) {
  await page.getByLabel(/^Mã ví người nhận/).fill(walletId);
  await page
    .getByRole("button", { name: "Tra cứu người nhận", exact: true })
    .click();
  await expect(page.getByText("Bình nhận", { exact: true })).toBeVisible();
  await page.getByLabel(/^Số tiền/).fill("10.000");
  await page.getByLabel(/^Lời nhắn/).fill("Ăn trưa");
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Xác nhận chuyển tiền" }),
  ).toBeVisible();
}
async function scan(page: Page) {
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
}
test("P2P review and receipt, owned outgoing/incoming history, filters and details", async ({
  page,
}, info) => {
  const { recipient, destination } = await setup(page);
  let posts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/v1/transfers")) posts++;
  });
  await review(page, destination.id);
  expect(posts).toBe(0);
  await expect(
    page.getByRole("button", { name: "Quay lại", exact: true }),
  ).toBeFocused();
  await scan(page);
  await page.getByRole("button", { name: "Quay lại", exact: true }).focus();
  await page.screenshot({
    path: `test-results/${info.project.name}-transfer-review.png`,
    fullPage: true,
  });
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Xác nhận chuyển", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Đã chuyển tiền", exact: true }),
  ).toBeVisible();
  expect(posts).toBe(1);
  const reference = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("nexapay.money-recovery")!),
  );
  expect(reference.operationType).toBe("TRANSFER");
  expect(Object.keys(reference).sort()).toEqual([
    "actorId",
    "environmentEpoch",
    "key",
    "operationType",
  ]);
  const terminal = await (
    await page.request.get(`/api/v1/commands/TRANSFER/${reference.key}`)
  ).json();
  await page.getByRole("link", { name: "Xem chi tiết", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Chi tiết giao dịch", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(terminal.resourceId, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Ăn trưa", { exact: true })).toBeVisible();
  await scan(page);
  await page
    .getByRole("link", { name: "Về lịch sử giao dịch", exact: true })
    .click();
  await expect(page.getByRole("article")).toHaveCount(2);
  await page
    .getByLabel("Loại giao dịch", { exact: true })
    .selectOption("OUTGOING");
  await page.getByRole("button", { name: "Lọc giao dịch" }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByLabel("Trạng thái", { exact: true }).selectOption("FAILED");
  await page.getByRole("button", { name: "Lọc giao dịch" }).click();
  await expect(
    page.getByText("Chưa có giao dịch phù hợp bộ lọc."),
  ).toBeVisible();
  await scan(page);
  await page.getByLabel("Trạng thái", { exact: true }).selectOption("");
  await page.getByRole("button", { name: "Lọc giao dịch" }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.locator("#main-content").focus();
  await page.screenshot({
    path: `test-results/${info.project.name}-history.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto("/app/overview");
  await expect(page.getByTestId("wallet-balance")).toHaveText("90.000 ₫");
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await page.goto("/auth/sign-in");
  await page.getByLabel(/^Email/).fill(recipient.email);
  await page.getByLabel(/^Mật khẩu/).fill(recipient.password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/overview$/);
  await page.goto("/app/transactions");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Nhận tiền", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Xem chi tiết", exact: true }).click();
  await expect(page.getByText("An chuyển", { exact: false })).toBeVisible();
  await page.goto("/app/overview");
  await expect(page.getByTestId("wallet-balance")).toHaveText("10.000 ₫");
});
test("lost transfer response, cross-operation recovery, reload and reauth never auto POST", async ({
  page,
}) => {
  const { sender, destination } = await setup(page);
  let posts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/v1/transfers")) posts++;
  });
  await review(page, destination.id);
  await page.route("**/api/v1/transfers", async (route) => {
    const result = await route.fetch();
    expect(result.status()).toBe(201);
    await route.abort("failed");
  });
  await page
    .getByRole("button", { name: "Xác nhận chuyển", exact: true })
    .click();
  await expect(
    page.getByText("Chưa xác định được kết quả.", { exact: false }),
  ).toBeVisible();
  await page.unroute("**/api/v1/transfers");
  await page.goto("/app/add-demo-funds");
  await expect(
    page.getByRole("heading", { name: "Đã chuyển tiền", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Nhận tiền demo", exact: true }),
  ).toHaveCount(0);
  await page.goto("/app/send");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Đã chuyển tiền", exact: true }),
  ).toBeVisible();
  expect(posts).toBe(1);
  await page.getByRole("button", { name: "Bắt đầu chuyển mới" }).click();
  await review(page, destination.id);
  await page.context().clearCookies();
  await page
    .getByRole("button", { name: "Xác nhận chuyển", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Đăng nhập", exact: true }),
  ).toBeVisible();
  await page.getByLabel(/^Email/).fill(sender.email);
  await page.getByLabel(/^Mật khẩu/).fill(sender.password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(
    page.getByText("Chưa quan sát được kết quả đã lưu", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Thử lại cùng mã" }),
  ).toBeVisible();
  expect(posts).toBe(2);
  const wallet = await (await page.request.get("/api/v1/wallets/me")).json();
  expect(wallet.availableBalance).toBe("90000");
  const list = await (await page.request.get("/api/v1/commands")).json();
  expect(
    list.items.filter(
      (i: { operationType: string }) => i.operationType === "TRANSFER",
    ),
  ).toHaveLength(1);
  const ref = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("nexapay.money-recovery")!),
  );
  const retry = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/api/v1/transfers"),
  );
  await page.getByRole("button", { name: "Thử lại cùng mã" }).click();
  expect((await retry).headers()["idempotency-key"]).toBe(ref.key);
  await expect(
    page.getByRole("heading", { name: "Đã chuyển tiền", exact: true }),
  ).toBeVisible();
  expect(posts).toBe(3);
  expect(
    (await (await page.request.get("/api/v1/wallets/me")).json())
      .availableBalance,
  ).toBe("80000");
});

test("terminal response refreshes history after leaving Send while request is pending", async ({
  page,
}) => {
  const { destination } = await setup(page);
  const nav = page.getByRole("navigation", { name: "Ví cá nhân" });
  await nav
    .getByRole("link", { name: "Lịch sử giao dịch", exact: true })
    .click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await nav.getByRole("link", { name: "Chuyển tiền", exact: true }).click();
  await review(page, destination.id);
  let release!: () => void;
  let committed!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const accepted = new Promise<void>((r) => (committed = r));
  await page.route("**/api/v1/transfers", async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    committed();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page
      .getByRole("button", { name: "Xác nhận chuyển", exact: true })
      .click();
    await accepted;
    await nav
      .getByRole("link", { name: "Lịch sử giao dịch", exact: true })
      .click();
    await expect(page.getByRole("article")).toHaveCount(1);
    release();
    await expect(page.getByRole("article")).toHaveCount(2);
  } finally {
    release();
  }
});
test("invalid grouped amount explains the format and never submits money", async ({
  page,
}) => {
  const { destination } = await setup(page);
  await page.getByLabel(/^Mã ví người nhận/).fill(destination.id);
  await page
    .getByRole("button", { name: "Tra cứu người nhận", exact: true })
    .click();
  await expect(page.getByText("Bình nhận", { exact: true })).toBeVisible();
  await page.getByLabel(/^Số tiền/).fill("1,000");
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await expect(
    page.getByText("Nhập số nguyên VND; dấu chấm chỉ dùng để phân nhóm nghìn."),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Xác nhận chuyển tiền" }),
  ).toHaveCount(0);
});
