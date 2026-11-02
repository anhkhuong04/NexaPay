import { request } from "./api";
import type { CommandResult } from "./funding";
export interface TransferCapabilities {
  environmentEpoch: string;
  minAmount: string;
  maxAmount: string;
  maxBalance: string;
  currency: "VND";
  fee: string;
  noteMaxLength: number;
}
export interface Recipient {
  walletId: string;
  displayName: string;
}
export interface TransferInput {
  destinationWalletId: string;
  amount: string;
  currency: "VND";
  note: string;
}
export type Direction = "INCOMING" | "OUTGOING" | "FUNDING";
export interface Transaction {
  id: string;
  operationType: CommandResult["operationType"];
  direction: Direction;
  status: "SUCCEEDED" | "FAILED";
  amount: string;
  currency: "VND";
  fee: string;
  sourceWalletId: string | null;
  destinationWalletId: string;
  senderName: string;
  recipientName: string;
  note: string;
  ledgerTransactionId: string | null;
  errorCode: string | null;
  createdAt: string;
  paymentId?: string | null;
}
export interface HistoryFilter {
  type: string;
  status: string;
  from: string;
  to: string;
}
export function parseVndInput(text: string, min: string, max: string): string {
  const value = text.trim();
  if (
    !/^[1-9][0-9]*$/.test(value) &&
    !/^[1-9][0-9]{0,2}(\.[0-9]{3})+$/.test(value)
  )
    throw new Error(
      "Nhập số nguyên VND; dấu chấm chỉ dùng để phân nhóm nghìn.",
    );
  const canonical = value.replaceAll(".", "");
  if (
    canonical.length > 19 ||
    BigInt(canonical) < BigInt(min) ||
    BigInt(canonical) > BigInt(max)
  )
    throw new Error("Số tiền nằm ngoài hạn mức cho phép.");
  return canonical;
}
export const transferApi = {
  capabilities: (signal?: AbortSignal) =>
    request<TransferCapabilities>("/transfers/capabilities", { signal }),
  recipient: (id: string, signal?: AbortSignal) =>
    request<Recipient>(`/recipients/${encodeURIComponent(id)}`, { signal }),
  send: async (key: string, body: TransferInput) => {
    const csrf = await request<{ token: string; headerName: string }>(
      "/auth/csrf",
      { signal: AbortSignal.timeout(30_000) },
    );
    return request<CommandResult>(
      "/transfers",
      {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
          [csrf.headerName]: csrf.token,
        },
        body: JSON.stringify(body),
      },
      true,
    );
  },
  history: (
    filter: HistoryFilter,
    cursor?: string,
    signal?: AbortSignal,
    limit = 20,
  ) => {
    const params = new URLSearchParams({ limit: String(limit) });
    for (const [k, v] of Object.entries(filter)) if (v) params.set(k, v);
    if (cursor) params.set("cursor", cursor);
    return request<{ items: Transaction[]; nextCursor: string | null }>(
      `/transactions?${params}`,
      { signal },
    );
  },
  detail: (type: string, id: string, signal?: AbortSignal) =>
    request<Transaction>(
      `/transactions/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
      { signal },
    ),
};
export function localTime(instant: string) {
  return new Date(instant).toLocaleString("vi-VN", { timeZoneName: "short" });
}
export function directionLabel(direction: Direction) {
  return {
    INCOMING: "Nhận tiền",
    OUTGOING: "Chuyển tiền",
    FUNDING: "Nhận tiền demo",
  }[direction];
}

export const transactionLabel = (
  transaction: Pick<Transaction, "operationType" | "direction">,
) =>
  transaction.operationType === "REFUND"
    ? "Nhận hoàn tiền"
    : transaction.operationType === "PAYMENT"
      ? "Thanh toán doanh nghiệp"
      : directionLabel(transaction.direction);
