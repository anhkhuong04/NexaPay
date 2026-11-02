import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { FluentProvider } from "@fluentui/react-components";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CheckoutPage, PaymentReview } from "./CheckoutPage";
import { paymentApi, type Checkout, type PaymentCapabilities } from "./payment";
import { api, ApiError, type Session, type Wallet } from "./api";
import { fundingApi, type CommandResult } from "./funding";
import { makeQueryClient, replaceActor } from "./session";
import { retainActorDraft } from "./moneyDrafts";
import { theme } from "./theme";
const ref = "11111111-1111-4111-8111-111111111111";
const session: Session = {
  userId: "A",
  roles: ["INDIVIDUAL"],
  authenticatedAt: "",
  absoluteExpiresAt: "",
};
const checkout: Checkout = {
  publicRef: ref,
  merchantName: "Merchant demo",
  amount: "10000",
  currency: "VND",
  description: "Coffee",
  status: "PENDING",
  createdAt: "2026-11-02T00:00:00Z",
  expiresAt: "2026-11-02T00:30:00Z",
};
const caps: PaymentCapabilities = {
  environmentEpoch: "E",
  minAmount: "1",
  maxAmount: "100000000",
  currency: "VND",
  fee: "0",
  descriptionMaxLength: 140,
  defaultExpiryMinutes: 30,
  minExpiryMinutes: 5,
  maxExpiryMinutes: 1440,
};
const wallet: Wallet = {
  id: "personal-wallet",
  availableBalance: "100000",
  heldBalance: "0",
  totalBalance: "100000",
  currency: "VND",
  status: "ACTIVE",
};
afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  retainActorDraft(null);
});
function setup(anonymous = false) {
  const client = makeQueryClient();
  client.setQueryData(["session"], anonymous ? null : session);
  vi.spyOn(api, "session").mockResolvedValue(session);
  vi.spyOn(api, "wallet").mockResolvedValue(wallet);
  vi.spyOn(paymentApi, "checkout").mockResolvedValue(checkout);
  vi.spyOn(paymentApi, "capabilities").mockResolvedValue(caps);
  vi.spyOn(fundingApi, "lookup").mockRejectedValue(
    new ApiError(404, "COMMAND_NOT_OBSERVED", "Unknown"),
  );
  render(
    <FluentProvider theme={theme}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/pay/${ref}`]}>
          <Routes>
            <Route path="/pay/:ref" element={<CheckoutPage />} />
            <Route path="/auth/sign-in" element={<h1>Sign in route</h1>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </FluentProvider>,
  );
  return client;
}
it("public preview requires login and never exposes a pay button before authenticated wallet review", async () => {
  const pay = vi.spyOn(paymentApi, "pay");
  setup(true);
  expect(
    await screen.findByRole("heading", { name: "Merchant demo" }),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Đăng nhập để thanh toán" }),
  ).toHaveAttribute("href", "/auth/sign-in");
  expect(
    screen.queryByRole("button", { name: "Xác nhận thanh toán" }),
  ).not.toBeInTheDocument();
  expect(pay).not.toHaveBeenCalled();
});
it("review precedes exactly one POST and authoritative receipt is a payment rather than funding", async () => {
  let resolve!: (r: CommandResult) => void;
  let sentKey = "";
  const pay = vi.spyOn(paymentApi, "pay").mockImplementation((key) => {
    sentKey = key;
    return new Promise((r) => (resolve = r));
  });
  const client = setup();
  await userEvent.click(
    await screen.findByRole("button", { name: "Xem lại thanh toán" }),
  );
  expect(
    screen.getByRole("region", { name: "Xác nhận thanh toán" }),
  ).toBeVisible();
  expect(pay).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Xác nhận thanh toán" }),
  );
  expect(pay).toHaveBeenCalledTimes(1);
  expect(pay).toHaveBeenCalledWith(sentKey, {
    reference: ref,
    amount: "10000",
    currency: "VND",
  });
  expect(
    screen.queryByRole("button", { name: "Xác nhận thanh toán" }),
  ).not.toBeInTheDocument();
  resolve({
    key: sentKey,
    operationType: "PAYMENT",
    resourceId: "attempt",
    status: "SUCCEEDED",
    originalHttpStatus: 201,
    createdAt: "2026-11-02T00:00:00Z",
    result: {
      amount: "10000",
      recipientName: "Merchant demo",
      requestRef: ref,
      paymentId: "payment",
    },
    error: {},
  });
  expect(
    await screen.findByRole("heading", { name: "Đã thanh toán" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Đã nhận tiền demo" }),
  ).not.toBeInTheDocument();
  expect(
    client.getQueryData(["command", "A", "PAYMENT", sentKey]),
  ).toMatchObject({ status: "SUCCEEDED" });
});
it("lost response stays UNKNOWN with original-key manual retry and no automatic resend", async () => {
  const pay = vi
    .spyOn(paymentApi, "pay")
    .mockRejectedValue(new ApiError(0, "NETWORK_ERROR", "Lost"));
  setup();
  await userEvent.click(
    await screen.findByRole("button", { name: "Xem lại thanh toán" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Xác nhận thanh toán" }),
  );
  expect(await screen.findByText(/Chưa xác định được kết quả/)).toBeVisible();
  expect(pay).toHaveBeenCalledTimes(1);
  const key = pay.mock.calls[0][0];
  await userEvent.click(
    screen.getByRole("button", { name: "Thử lại cùng mã" }),
  );
  await waitFor(() => expect(pay).toHaveBeenCalledTimes(2));
  expect(pay.mock.calls[1][0]).toBe(key);
});
it("late committed payment after actor switch cannot overwrite the new actor", async () => {
  let resolve!: (r: CommandResult) => void;
  let key = "";
  vi.spyOn(paymentApi, "pay").mockImplementation((k) => {
    key = k;
    return new Promise((r) => (resolve = r));
  });
  const client = setup();
  await userEvent.click(
    await screen.findByRole("button", { name: "Xem lại thanh toán" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Xác nhận thanh toán" }),
  );
  await replaceActor(client, { ...session, userId: "B" });
  resolve({
    key,
    operationType: "PAYMENT",
    resourceId: "old-attempt",
    status: "SUCCEEDED",
    originalHttpStatus: 201,
    createdAt: "",
    result: { amount: "10000" },
    error: {},
  });
  await waitFor(() =>
    expect(client.getQueryData(["session"])).toMatchObject({ userId: "B" }),
  );
  expect(client.getQueryData(["command", "A", "PAYMENT", key])).toBeUndefined();
});

it("a refreshed terminal request or locked wallet disables confirmation within an already open review", async () => {
  const confirm = vi.fn();
  const back = vi.fn();
  const view = render(
    <FluentProvider theme={theme}>
      <PaymentReview
        checkout={{ ...checkout, status: "EXPIRED" }}
        wallet={wallet}
        fee="0"
        confirm={confirm}
        back={back}
      />
    </FluentProvider>,
  );
  expect(
    screen.getByRole("button", { name: "Xác nhận thanh toán" }),
  ).toBeDisabled();
  await userEvent.click(
    screen.getByRole("button", { name: "Xác nhận thanh toán" }),
  );
  expect(confirm).not.toHaveBeenCalled();
  view.rerender(
    <FluentProvider theme={theme}>
      <PaymentReview
        checkout={checkout}
        wallet={{ ...wallet, status: "LOCKED" }}
        fee="0"
        confirm={confirm}
        back={back}
      />
    </FluentProvider>,
  );
  expect(
    screen.getByRole("button", { name: "Xác nhận thanh toán" }),
  ).toBeDisabled();
  view.rerender(
    <FluentProvider theme={theme}>
      <PaymentReview
        checkout={checkout}
        wallet={wallet}
        fee="0"
        confirm={confirm}
        back={back}
      />
    </FluentProvider>,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Xác nhận thanh toán" }),
  );
  expect(confirm).toHaveBeenCalledTimes(1);
});

it("a payment 401 consistently returns to the public login prompt while preserving its recovery reference", async () => {
  const pay = vi
    .spyOn(paymentApi, "pay")
    .mockRejectedValue(new ApiError(401, "UNAUTHENTICATED", "Login"));
  setup();
  await userEvent.click(
    await screen.findByRole("button", { name: "Xem lại thanh toán" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Xác nhận thanh toán" }),
  );
  expect(
    await screen.findByRole("link", { name: "Đăng nhập để thanh toán" }),
  ).toHaveAttribute("href", "/auth/sign-in");
  expect(pay).toHaveBeenCalledTimes(1);
  expect(sessionStorage.getItem("nexapay.money-recovery")).toContain(ref);
  expect(
    screen.queryByRole("button", { name: "Xác nhận thanh toán" }),
  ).not.toBeInTheDocument();
});
