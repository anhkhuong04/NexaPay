import { request } from "./api";
import type { CommandResult } from "./funding";
import type { Payment, PaymentPage } from "./payment";
export interface RefundInput {
  merchantId: string;
  paymentId: string;
  amount: string;
  currency: "VND";
  note: string;
}
export interface Refund {
  id: string;
  paymentId: string;
  amount: string;
  currency: "VND";
  note: string;
  payerName: string;
  status: "SUCCEEDED" | "FAILED";
  ledgerTransactionId: string | null;
  errorCode: string | null;
  createdAt: string;
}
export const refundStatusLabel = (status: Payment["refundStatus"]) =>
  ({
    NONE: "Chưa hoàn tiền",
    PARTIAL: "Đã hoàn một phần",
    FULL: "Đã hoàn toàn bộ",
  })[status];
export const refundApi = {
  payment: (merchant: string, id: string, signal?: AbortSignal) =>
    request<Payment>(`/merchants/${merchant}/payments/${id}`, { signal }),
  list: (
    merchant: string,
    status: string,
    cursor?: string,
    signal?: AbortSignal,
    paymentId?: string,
  ) =>
    request<PaymentPage<Refund>>(
      `/merchants/${merchant}/refunds?${new URLSearchParams({ limit: "20", ...(status ? { status } : {}), ...(cursor ? { cursor } : {}), ...(paymentId ? { paymentId } : {}) })}`,
      { signal },
    ),
  detail: (merchant: string, id: string, signal?: AbortSignal) =>
    request<Refund>(`/merchants/${merchant}/refunds/${id}`, { signal }),
  send: async (key: string, body: RefundInput) => {
    const csrf = await request<{ token: string; headerName: string }>(
      "/auth/csrf",
      { signal: AbortSignal.timeout(30000) },
    );
    return request<CommandResult>(
      `/merchants/${body.merchantId}/payments/${body.paymentId}/refunds`,
      {
        method: "POST",
        signal: AbortSignal.timeout(30000),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
          [csrf.headerName]: csrf.token,
        },
        body: JSON.stringify({
          amount: body.amount,
          currency: body.currency,
          note: body.note,
        }),
      },
      true,
    );
  },
};
