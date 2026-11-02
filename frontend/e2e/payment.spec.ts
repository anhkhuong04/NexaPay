import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import jsQR from "jsqr";
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
async function review(page: Page) {
  await page
    .getByRole("button", { name: "Xem lại thanh toán", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Xác nhận thanh toán" }),
  ).toBeVisible();
}
async function confirm(page: Page) {
  await page
    .getByRole("button", { name: "Xác nhận thanh toán", exact: true })
    .focus();
  await page.keyboard.press("Enter");
}

test("request QR and checkout: failed intent then payment, owned histories and cancel filters", async ({
  page,
}, info) => {
  const payer = await account(page, "Payer demo");
  expect((await post(page, "/auth/logout", {})).status()).toBe(204);
  const o = await owner(page);
  let creates = 0,
    pays = 0;
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      r.url().includes("/checkout/") &&
      r.url().endsWith("/pay")
    )
      pays++;
    if (r.method() === "POST" && r.url().endsWith("/payment-requests"))
      creates++;
  });
  await page.route("**/api/v1/merchants/*/payment-requests", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("failed");
  });
  await page.goto("/business/payment-requests/new");
  await page.getByLabel(/^Số tiền/).fill("10.000");
  await page.getByLabel(/^Mô tả thanh toán/).fill("  Cafe\u0301 order  ");
  await page
    .getByRole("button", { name: "Tạo yêu cầu thanh toán", exact: true })
    .click();
  await expect(
    page.getByText(/Chưa xác định được kết quả tạo yêu cầu/),
  ).toBeVisible();
  expect(creates).toBe(1);
  await page.unroute("**/api/v1/merchants/*/payment-requests");
  await page
    .getByRole("button", { name: "Kiểm tra yêu cầu đã tạo", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Chờ thanh toán", exact: true }),
  ).toBeVisible();
  const url = await page
    .getByLabel("Liên kết thanh toán", { exact: true })
    .inputValue();
  const ref = url.split("/").at(-1)!;
  const requestId = page.url().split("/").at(-1)!;
  const image = page.getByRole("img", {
    name: "Mã QR mở trang thanh toán",
    exact: true,
  });
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate(
        (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
      ),
    )
    .toBe(true);
  const bitmap = await image.evaluate((node: HTMLImageElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = node.naturalWidth;
    canvas.height = node.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(node, 0, 0);
    return {
      width: canvas.width,
      height: canvas.height,
      data: Array.from(
        ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      ),
    };
  });
  expect(
    jsQR(new Uint8ClampedArray(bitmap.data), bitmap.width, bitmap.height)?.data,
  ).toBe(url);
  expect(new URL(url).origin).toBe(new URL(page.url()).origin);
  expect(creates).toBe(1);
  await scan(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `test-results/${info.project.name}-request-share.png`,
    fullPage: true,
  });
  expect(
    await page
      .getByRole("button", { name: "Hủy yêu cầu", exact: true })
      .evaluate((n) => n.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  await logout(page);
  await page.goto(`/pay/${ref}`);
  await expect(
    page.getByRole("link", { name: "Đăng nhập để thanh toán", exact: true }),
  ).toBeVisible();
  await scan(page);
  await page
    .getByRole("link", { name: "Đăng nhập để thanh toán", exact: true })
    .click();
  await login(page, payer);
  await expect(page).toHaveURL(url);
  await review(page);
  expect(pays).toBe(0);
  await scan(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `test-results/${info.project.name}-checkout-review.png`,
    fullPage: true,
  });
  const originalViewport = page.viewportSize()!;
  await page.setViewportSize({ width: 320, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Xác nhận thanh toán", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/${info.project.name}-checkout-320.png`,
    fullPage: true,
  });
  await page.setViewportSize(originalViewport);
  if (info.project.name === "desktop") {
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/desktop-checkout-zoom200.png",
      fullPage: true,
    });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "";
    });
  }
  await confirm(page);
  await expect(
    page.getByRole("heading", { name: "Thao tác bị từ chối", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("không đủ số dư");
  expect(
    (await (await page.request.get(`/api/v1/checkout/${ref}`)).json()).status,
  ).toBe("PENDING");
  await fund(page);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Thao tác bị từ chối", exact: true }),
  ).toBeVisible();
  expect(pays).toBe(1);
  await page
    .getByRole("button", { name: "Bắt đầu thanh toán mới", exact: true })
    .click();
  await review(page);
  await confirm(page);
  await expect(
    page.getByRole("heading", { name: "Đã thanh toán", exact: true }),
  ).toBeVisible();
  expect(pays).toBe(2);
  await scan(page);
  await page.getByRole("link", { name: "Xem chi tiết", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Thanh toán doanh nghiệp", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Ví cá nhân", exact: true })
    .getByRole("link", { name: "Tổng quan", exact: true })
    .click();
  await expect(page.getByTestId("wallet-balance")).toHaveText("90.000 ₫");
  await expect(
    page
      .getByRole("region", { name: "Giao dịch gần đây" })
      .getByText("Thanh toán doanh nghiệp", { exact: true }),
  ).toHaveCount(2);
  await logout(page);
  await login(page, o.credentials);
  await expect(page.getByTestId("wallet-balance")).toHaveText("0 ₫");
  await page
    .getByRole("navigation", { name: "Không gian làm việc" })
    .getByRole("link", { name: "Doanh nghiệp", exact: true })
    .click();
  await expect(page.getByTestId("merchant-balance")).toHaveText("10.000 ₫");
  await page.goto(`/business/payment-requests/${requestId}`);
  await expect(
    page.getByRole("heading", { name: "Đã thanh toán", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Hủy yêu cầu", exact: true }),
  ).toHaveCount(0);
  const cancel = await request(page, o.merchant.id, "1");
  await page.goto(`/business/payment-requests/${cancel.id}`);
  await page.getByRole("button", { name: "Hủy yêu cầu", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Xác nhận hủy yêu cầu", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Xác nhận hủy yêu cầu", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Đã hủy", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Về danh sách yêu cầu", exact: true })
    .click();
  await page
    .getByLabel("Trạng thái yêu cầu", { exact: true })
    .selectOption("CANCELLED");
  await expect(
    page.getByRole("link", { name: "Xem yêu cầu", exact: true }),
  ).toHaveCount(1);
  await scan(page);
  await page.setViewportSize({ width: 320, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("committed payment response loss recovers across funding and reload without another POST", async ({
  page,
}) => {
  const o = await owner(page);
  const req = await request(page, o.merchant.id);
  expect((await post(page, "/auth/logout", {})).status()).toBe(204);
  await account(page, "Recovery payer");
  await fund(page);
  let posts = 0,
    fundPosts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/pay")) posts++;
    if (r.method() === "POST" && r.url().endsWith("/demo-fundings"))
      fundPosts++;
  });
  let original: Record<string, unknown> | undefined;
  await page.route("**/api/v1/checkout/*/pay", async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    original = await response.json();
    await route.abort("failed");
  });
  await page.goto(`/pay/${req.publicRef}`);
  await review(page);
  await confirm(page);
  await expect(page.getByText(/Chưa xác định được kết quả/)).toBeVisible();
  await page.unroute("**/api/v1/checkout/*/pay");
  await page.goto("/app/add-demo-funds");
  await expect(
    page.getByRole("heading", { name: "Đã thanh toán", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Nhận tiền demo", exact: true }),
  ).toHaveCount(0);
  expect(posts).toBe(1);
  expect(fundPosts).toBe(0);
  await page.goto(`/pay/${req.publicRef}`);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Đã thanh toán", exact: true }),
  ).toBeVisible();
  expect(posts).toBe(1);
  const replay = await post(
    page,
    `/checkout/${req.publicRef}/pay`,
    { amount: "10000", currency: "VND" },
    original!.key as string,
  );
  expect(replay.status()).toBe(201);
  expect(await replay.json()).toEqual(original);
  expect(
    (await (await page.request.get("/api/v1/wallets/me")).json())
      .availableBalance,
  ).toBe("90000");
  await page.goto("/app/commands");
  await expect(page.getByText("Đã thanh toán", { exact: true })).toBeVisible();
});

test("payment reauthentication looks up first and only manually retries original key", async ({
  page,
}) => {
  const o = await owner(page);
  const req = await request(page, o.merchant.id);
  expect((await post(page, "/auth/logout", {})).status()).toBe(204);
  const payer = await account(page, "Reauth payer");
  await fund(page);
  const keys: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/pay"))
      keys.push(r.headers()["idempotency-key"]);
  });
  await page.goto(`/pay/${req.publicRef}`);
  await review(page);
  await page.context().clearCookies();
  await confirm(page);
  await expect(
    page.getByRole("link", { name: "Đăng nhập để thanh toán", exact: true }),
  ).toBeVisible();
  await expect.poll(() => keys.length).toBe(1);
  await page
    .getByRole("link", { name: "Đăng nhập để thanh toán", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Đăng nhập", exact: true }),
  ).toBeVisible();
  const saved = await page.evaluate(() =>
    sessionStorage.getItem("nexapay.money-recovery"),
  );
  expect(saved).not.toContain("amount");
  expect(saved).not.toContain("10000");
  await login(page, payer);
  await expect(page).toHaveURL(new RegExp(`/pay/${req.publicRef}$`));
  await expect(
    page.getByText(
      "Chưa quan sát được kết quả đã lưu; đây chưa phải kết luận thất bại.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(keys).toHaveLength(1);
  await page
    .getByRole("button", { name: "Thử lại cùng mã", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Đã thanh toán", exact: true }),
  ).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  expect(
    (await (await page.request.get("/api/v1/wallets/me")).json())
      .availableBalance,
  ).toBe("90000");
});

test("late committed payment response refreshes active Overview after leaving checkout", async ({
  page,
}) => {
  const o = await owner(page);
  const req = await request(page, o.merchant.id);
  expect((await post(page, "/auth/logout", {})).status()).toBe(204);
  await account(page, "Late payer");
  await fund(page);
  await page.goto(`/pay/${req.publicRef}`);
  await page
    .getByRole("navigation", { name: "Điều hướng thanh toán" })
    .getByRole("link", { name: "Về ví cá nhân", exact: true })
    .click();
  await expect(page.getByTestId("wallet-balance")).toHaveText("100.000 ₫");
  await expect(
    page
      .getByRole("region", { name: "Giao dịch gần đây" })
      .getByRole("article"),
  ).toHaveCount(1);
  await page.goBack();
  await review(page);
  let release!: () => void;
  let committed!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const ready = new Promise<void>((r) => (committed = r));
  await page.route("**/api/v1/checkout/*/pay", async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    committed();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await confirm(page);
    await ready;
    await page
      .getByRole("navigation", { name: "Điều hướng thanh toán" })
      .getByRole("link", { name: "Về ví cá nhân", exact: true })
      .click();
    await expect(page.getByTestId("wallet-balance")).toHaveText("100.000 ₫");
    release();
    await expect(page.getByTestId("wallet-balance")).toHaveText("90.000 ₫");
    await expect(
      page
        .getByRole("region", { name: "Giao dịch gần đây" })
        .getByRole("article"),
    ).toHaveCount(2);
    await expect(
      page
        .getByRole("region", { name: "Giao dịch gần đây" })
        .getByText("Thanh toán doanh nghiệp", { exact: true }),
    ).toBeVisible();
  } finally {
    release();
  }
});
