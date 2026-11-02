import { request, type Session } from "./api";
import { clearMemoryIntent } from "./moneyDrafts";
import type { QueryClient } from "@tanstack/react-query";

export interface FundingInput {
  amount: string;
  currency: "VND";
}
export interface FundingCapabilities {
  enabled: boolean;
  environmentEpoch: string;
  presetAmount: string;
  currency: "VND";
  userRemaining: string;
  environmentRemaining: string;
  nextResetAt: string;
}
export interface CommandResult {
  key: string;
  operationType: "DEMO_FUNDING" | "TRANSFER" | "PAYMENT" | "REFUND";
  resourceId: string;
  status: "SUCCEEDED" | "FAILED";
  originalHttpStatus: 201 | 422;
  createdAt: string;
  result: {
    amount?: string;
    currency?: string;
    walletId?: string;
    ledgerTransactionId?: string;
    fee?: string;
    sourceWalletId?: string;
    destinationWalletId?: string;
    recipientName?: string;
    note?: string;
    requestRef?: string;
    paymentId?: string;
    merchantId?: string;
  };
  error: { code?: string; message?: string };
}
export interface CommandPage {
  items: CommandResult[];
  nextCursor: string | null;
}
export interface Recovery {
  merchantId?: string;
  paymentId?: string;
  checkoutRef?: string;
  environmentEpoch: string;
  actorId: string;
  operationType: "DEMO_FUNDING" | "TRANSFER" | "PAYMENT" | "REFUND";
  key: string;
}
export const RECOVERY_KEY = "nexapay.money-recovery";
export function cacheTerminal(
  client: QueryClient,
  actorId: string,
  result: CommandResult,
) {
  if (client.getQueryData<Session | null>(["session"])?.userId !== actorId)
    return false;
  client.setQueryData(
    ["command", actorId, result.operationType, result.key],
    result,
  );
  clearMemoryIntent(actorId, result.operationType, result.key);
  refreshMoneyViews(client, actorId);
  return true;
}
export function refreshMoneyViews(client: QueryClient, actorId: string) {
  if (client.getQueryData<Session | null>(["session"])?.userId !== actorId)
    return;
  for (const domain of [
    "wallet",
    "history",
    "commands",
    "funding",
    "checkout",
    "payment-requests",
    "merchant-payments",
    "refunds",
  ])
    void client.invalidateQueries({ queryKey: [domain, actorId] });
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function readRecovery(actorId: string, epoch: string): Recovery | null {
  try {
    const raw: unknown = JSON.parse(
      sessionStorage.getItem(RECOVERY_KEY) ?? "null",
    );
    if (
      raw &&
      typeof raw === "object" &&
      "actorId" in raw &&
      raw.actorId === actorId &&
      "environmentEpoch" in raw &&
      raw.environmentEpoch === epoch &&
      "operationType" in raw &&
      (raw.operationType === "DEMO_FUNDING" ||
        raw.operationType === "TRANSFER" ||
        (raw.operationType === "REFUND" &&
          "merchantId" in raw &&
          typeof raw.merchantId === "string" &&
          uuid.test(raw.merchantId) &&
          "paymentId" in raw &&
          typeof raw.paymentId === "string" &&
          uuid.test(raw.paymentId)) ||
        (raw.operationType === "PAYMENT" &&
          "checkoutRef" in raw &&
          typeof raw.checkoutRef === "string" &&
          uuid.test(raw.checkoutRef))) &&
      "key" in raw &&
      typeof raw.key === "string" &&
      uuid.test(raw.key)
    )
      return {
        actorId,
        environmentEpoch: epoch,
        operationType: raw.operationType,
        key: raw.key,
        ...(raw.operationType === "REFUND" &&
        "merchantId" in raw &&
        "paymentId" in raw
          ? {
              merchantId: raw.merchantId as string,
              paymentId: raw.paymentId as string,
            }
          : {}),
        ...(raw.operationType === "PAYMENT" && "checkoutRef" in raw
          ? { checkoutRef: raw.checkoutRef as string }
          : {}),
      };
  } catch {
    /* Invalid reference is discarded; never replay stored payload. */
  }
  sessionStorage.removeItem(RECOVERY_KEY);
  return null;
}
export function saveRecovery(value: Recovery) {
  sessionStorage.setItem(RECOVERY_KEY, JSON.stringify(value));
}
export const fundingApi = {
  capabilities: (signal?: AbortSignal) =>
    request<FundingCapabilities>("/demo-fundings/capabilities", { signal }),
  lookup: (
    key: string,
    signal?: AbortSignal,
    type: CommandResult["operationType"] = "DEMO_FUNDING",
  ) => request<CommandResult>(`/commands/${type}/${key}`, { signal }),
  recent: (cursor?: string, signal?: AbortSignal) =>
    request<CommandPage>(
      `/commands?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      { signal },
    ),
  fund: async (key: string, body: FundingInput) => {
    const csrf = await request<{ token: string; headerName: string }>(
      "/auth/csrf",
      { signal: AbortSignal.timeout(30_000) },
    );
    return request<CommandResult>(
      "/demo-fundings",
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
};

export function recoveryPath(
  intent: Pick<Recovery, "operationType" | "checkoutRef" | "paymentId">,
) {
  if (intent.operationType === "REFUND")
    return `/business/payments/${intent.paymentId}/refund`;
  if (intent.operationType === "PAYMENT") return `/pay/${intent.checkoutRef}`;
  return intent.operationType === "TRANSFER"
    ? "/app/send"
    : "/app/add-demo-funds";
}
