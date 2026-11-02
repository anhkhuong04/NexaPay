import { request, type Session } from "./api";
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
  operationType: "DEMO_FUNDING";
  resourceId: string;
  status: "SUCCEEDED" | "FAILED";
  originalHttpStatus: 201 | 422;
  createdAt: string;
  result: {
    amount?: string;
    currency?: string;
    walletId?: string;
    ledgerTransactionId?: string;
  };
  error: { code?: string; message?: string };
}
export interface CommandPage {
  items: CommandResult[];
  nextCursor: string | null;
}
export interface Recovery {
  environmentEpoch: string;
  actorId: string;
  operationType: "DEMO_FUNDING";
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
  client.setQueryData(["command", actorId, "DEMO_FUNDING", result.key], result);
  return true;
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
      raw.operationType === "DEMO_FUNDING" &&
      "key" in raw &&
      typeof raw.key === "string" &&
      uuid.test(raw.key)
    )
      return {
        actorId,
        environmentEpoch: epoch,
        operationType: "DEMO_FUNDING",
        key: raw.key,
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
  lookup: (key: string, signal?: AbortSignal) =>
    request<CommandResult>(`/commands/DEMO_FUNDING/${key}`, { signal }),
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
