import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FluentProvider } from "@fluentui/react-components";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Outlet, Routes, Route } from "react-router-dom";
import { RefundPage } from "./RefundPages";
import { refundApi } from "./refund";
import { paymentApi, type Payment } from "./payment";
import { merchantApi } from "./merchant";
import { ApiError, type Session } from "./api";
import {
  fundingApi,
  readRecovery,
  saveRecovery,
  type CommandResult,
} from "./funding";
import { retainActorDraft } from "./moneyDrafts";
import { makeQueryClient, replaceActor, safeReturnTo } from "./session";
import { theme } from "./theme";
const actor = "11111111-1111-4111-8111-111111111111",
  merchant = "22222222-2222-4222-8222-222222222222",
  payment = "33333333-3333-4333-8333-333333333333",
  epoch = "44444444-4444-4444-8444-444444444444";
const session: Session = {
  userId: actor,
  roles: ["INDIVIDUAL", "MERCHANT"],
  merchantId: merchant,
  authenticatedAt: "",
  absoluteExpiresAt: "",
};
const capture: Payment = {
  id: payment,
  requestId: payment,
  requestRef: payment,
  amount: "10000",
  currency: "VND",
  payerName: "Original payer",
  paidAt: "2026-11-02T00:00:00Z",
  ledgerTransactionId: payment,
  refundedAmount: "3000",
  refundableAmount: "7000",
  refundStatus: "PARTIAL",
};
function setup() {
  const client = makeQueryClient();
  client.setQueryData(["session"], session);
  vi.spyOn(merchantApi, "own").mockResolvedValue({
    id: merchant,
    displayName: "Merchant",
    status: "ACTIVE",
    createdAt: "",
    updatedAt: "",
  });
  vi.spyOn(merchantApi, "wallet").mockResolvedValue({
    id: merchant,
    currency: "VND",
    status: "ACTIVE",
    availableBalance: "7000",
    totalBalance: "7000",
    heldBalance: "0",
  });
  vi.spyOn(paymentApi, "capabilities").mockResolvedValue({
    environmentEpoch: epoch,
    minAmount: "1",
    maxAmount: "100000000",
    currency: "VND",
    fee: "0",
    descriptionMaxLength: 140,
    defaultExpiryMinutes: 30,
    minExpiryMinutes: 5,
    maxExpiryMinutes: 1440,
  });
  vi.spyOn(refundApi, "payment").mockResolvedValue(capture);
  vi.spyOn(fundingApi, "lookup").mockRejectedValue(
    new ApiError(404, "COMMAND_NOT_OBSERVED", "Unknown"),
  );
  render(
    <FluentProvider theme={theme}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/business/payments/${payment}/refund`]}>
          <Routes>
            <Route element={<Outlet context={session} />}>
              <Route
                path="/business/payments/:id/refund"
                element={<RefundPage mode="form" />}
              />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </FluentProvider>,
  );
  return client;
}
afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  retainActorDraft(null);
});
async function review() {
  await userEvent.click(
    await screen.findByRole("button", { name: "Hoàn toàn bộ phần còn lại" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Xem lại hoàn tiền" }),
  );
  await screen.findByRole("region", { name: "Xác nhận hoàn tiền" });
}
const terminal = (key: string): CommandResult => ({
  key,
  operationType: "REFUND",
  resourceId: payment,
  status: "SUCCEEDED",
  originalHttpStatus: 201,
  createdAt: "2026-11-02T00:00:00Z",
  result: {
    amount: "7000",
    currency: "VND",
    paymentId: payment,
    merchantId: merchant,
    recipientName: "Original payer",
    sourceWalletId: merchant,
    destinationWalletId: actor,
  },
  error: {},
});
it("full remaining review precedes one POST and a refund receipt links to business detail", async () => {
  const send = vi
    .spyOn(refundApi, "send")
    .mockImplementation(async (key) => terminal(key));
  setup();
  await review();
  expect(send).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Xác nhận hoàn tiền" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Đã hoàn tiền" }),
  ).toBeVisible();
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][1]).toMatchObject({
    merchantId: merchant,
    paymentId: payment,
    amount: "7000",
    currency: "VND",
  });
  expect(screen.getByRole("link", { name: "Xem chi tiết" })).toHaveAttribute(
    "href",
    `/business/refunds/${payment}`,
  );
});
it("over-remaining amount stays at the form without sending or opening review", async () => {
  const send = vi.spyOn(refundApi, "send");
  setup();
  await userEvent.type(await screen.findByLabelText(/^Số tiền hoàn/), "8.000");
  await userEvent.click(
    screen.getByRole("button", { name: "Xem lại hoàn tiền" }),
  );
  expect(
    await screen.findByText("Số tiền vượt phần còn được hoàn."),
  ).toBeVisible();
  expect(
    screen.queryByRole("region", { name: "Xác nhận hoàn tiền" }),
  ).not.toBeInTheDocument();
  expect(send).not.toHaveBeenCalled();
});
it("lost response preserves a reference-only intent and manually retries original key and payload", async () => {
  const send = vi
    .spyOn(refundApi, "send")
    .mockRejectedValue(new ApiError(0, "NETWORK_ERROR", "Lost"));
  setup();
  await review();
  await userEvent.click(
    screen.getByRole("button", { name: "Xác nhận hoàn tiền" }),
  );
  await screen.findByRole("button", { name: "Thử lại cùng mã" });
  expect(send).toHaveBeenCalledTimes(1);
  const original = send.mock.calls[0];
  const stored = sessionStorage.getItem("nexapay.money-recovery")!;
  expect(stored).not.toContain("7000");
  expect(stored).not.toContain("note");
  expect(JSON.parse(stored)).toMatchObject({
    operationType: "REFUND",
    merchantId: merchant,
    paymentId: payment,
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Thử lại cùng mã" }),
  );
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send.mock.calls[1]).toEqual(original);
});
it("refetched remaining amount disables an already-open review before confirmation", async () => {
  const send = vi.spyOn(refundApi, "send");
  const client = setup();
  await review();
  client.setQueryData(
    ["merchant-payments", actor, "business", merchant, "detail", payment],
    {
      ...capture,
      refundableAmount: "0",
      refundedAmount: "10000",
      refundStatus: "FULL",
    },
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Xác nhận hoàn tiền" }),
    ).toBeDisabled(),
  );
  expect(send).not.toHaveBeenCalled();
});
it("late refund response cannot populate a new actor cache", async () => {
  let resolve!: (value: CommandResult) => void;
  let key = "";
  vi.spyOn(refundApi, "send").mockImplementation((k) => {
    key = k;
    return new Promise((r) => (resolve = r));
  });
  const client = setup();
  await review();
  await userEvent.click(
    screen.getByRole("button", { name: "Xác nhận hoàn tiền" }),
  );
  client.setQueryData(["session"], { ...session, userId: "B" });
  resolve(terminal(key));
  await waitFor(() =>
    expect(
      screen.queryByText("Đang xác nhận hoàn tiền…"),
    ).not.toBeInTheDocument(),
  );
  expect(
    client.getQueryData(["command", actor, "REFUND", key]),
  ).toBeUndefined();
  expect(client.getQueryData(["command", "B", "REFUND", key])).toBeUndefined();
});
it("refund recovery validates resource references, keeps same actor through reauth and clears on logout", async () => {
  const key = crypto.randomUUID();
  const ref = {
    actorId: actor,
    environmentEpoch: epoch,
    operationType: "REFUND" as const,
    key,
    merchantId: merchant,
    paymentId: payment,
  };
  saveRecovery(ref);
  const client = makeQueryClient();
  await replaceActor(client, session);
  expect(readRecovery(actor, epoch)).toEqual(ref);
  expect(safeReturnTo(`/business/payments/${payment}/refund`)).toBe(
    `/business/payments/${payment}/refund`,
  );
  expect(
    safeReturnTo(`/business/payments/${payment}/refund?redirect=evil`),
  ).toBe("/app/overview");
  saveRecovery({ ...ref, paymentId: "not-uuid" });
  expect(readRecovery(actor, epoch)).toBeNull();
  saveRecovery(ref);
  await replaceActor(client, null);
  expect(readRecovery(actor, epoch)).toBeNull();
});
it("another refund payment cannot retry the saved payload on this route", async () => {
  const other = crypto.randomUUID();
  saveRecovery({
    actorId: actor,
    environmentEpoch: epoch,
    operationType: "REFUND",
    key: crypto.randomUUID(),
    merchantId: merchant,
    paymentId: other,
  });
  setup();
  expect(
    await screen.findByRole("link", { name: "Tiếp tục thao tác đang lưu" }),
  ).toHaveAttribute("href", `/business/payments/${other}/refund`);
  expect(
    screen.queryByRole("button", { name: "Thử lại cùng mã" }),
  ).not.toBeInTheDocument();
});
