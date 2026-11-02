import { mutate, request } from "./api";
import type { CommandResult } from "./funding";
export interface PaymentCapabilities {
  environmentEpoch: string;
  minAmount: string;
  maxAmount: string;
  currency: "VND";
  fee: string;
  descriptionMaxLength: number;
  defaultExpiryMinutes: number;
  minExpiryMinutes: number;
  maxExpiryMinutes: number;
}
export interface Checkout {
  publicRef: string;
  merchantName: string;
  amount: string;
  currency: "VND";
  description: string;
  status: "PENDING" | "PAID" | "EXPIRED" | "CANCELLED";
  createdAt: string;
  expiresAt: string;
}
export interface Payment {
  refundedAmount: string;
  refundableAmount: string;
  refundStatus: "NONE" | "PARTIAL" | "FULL";
  id: string;
  requestId: string;
  requestRef: string;
  amount: string;
  currency: "VND";
  payerName: string;
  paidAt: string;
  ledgerTransactionId: string;
}
export interface PaymentRequest extends Checkout {
  id: string;
  payment: Payment | null;
}
export interface CreateRequest {
  amount: string;
  currency: "VND";
  description: string;
  expiryMinutes: number;
}
export interface PayInput {
  reference: string;
  amount: string;
  currency: "VND";
}
export interface PaymentPage<T> {
  items: T[];
  nextCursor: string | null;
}
export interface PaymentSummary {
  refundsToday: number;
  refundedToday: string;
  paidToday: number;
  receivedToday: string;
  pendingRequests: number;
  recentPayments: Payment[];
}
export const paymentKey = (actor: string, merchant: string) =>
  ["payment-requests", actor, "business", merchant] as const;
export function checkoutPath(ref: string) {
  return `/pay/${ref}`;
}
export function checkoutUrl(ref: string) {
  return new URL(checkoutPath(ref), window.location.origin).href;
}
export const statusLabel = (status: Checkout["status"]) =>
  ({
    PENDING: "Chờ thanh toán",
    PAID: "Đã thanh toán",
    EXPIRED: "Hết hạn",
    CANCELLED: "Đã hủy",
  })[status];
async function keyed<T>(
  path: string,
  key: string,
  body: unknown,
  terminal = false,
) {
  const csrf = await request<{ token: string; headerName: string }>(
    "/auth/csrf",
    { signal: AbortSignal.timeout(30_000) },
  );
  return request<T>(
    path,
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
    terminal,
  );
}
export const paymentApi = {
  capabilities: (signal?: AbortSignal) =>
    request<PaymentCapabilities>("/payment-requests/capabilities", { signal }),
  create: (merchant: string, key: string, body: CreateRequest) =>
    keyed<PaymentRequest>(`/merchants/${merchant}/payment-requests`, key, body),
  lookupCreate: (merchant: string, key: string, signal?: AbortSignal) =>
    request<PaymentRequest>(
      `/merchants/${merchant}/payment-requests/by-key/${key}`,
      { signal },
    ),
  list: (
    merchant: string,
    status: string,
    cursor?: string,
    signal?: AbortSignal,
  ) =>
    request<PaymentPage<PaymentRequest>>(
      `/merchants/${merchant}/payment-requests?${new URLSearchParams({ limit: "20", ...(status ? { status } : {}), ...(cursor ? { cursor } : {}) })}`,
      { signal },
    ),
  detail: (merchant: string, id: string, signal?: AbortSignal) =>
    request<PaymentRequest>(`/merchants/${merchant}/payment-requests/${id}`, {
      signal,
    }),
  cancel: (merchant: string, id: string) =>
    mutate<PaymentRequest>(
      `/merchants/${merchant}/payment-requests/${id}/cancel`,
      "POST",
    ),
  checkout: (ref: string, signal?: AbortSignal) =>
    request<Checkout>(`/checkout/${ref}`, { signal }),
  pay: (key: string, body: PayInput) =>
    keyed<CommandResult>(
      `/checkout/${body.reference}/pay`,
      key,
      { amount: body.amount, currency: body.currency },
      true,
    ),
  payments: (merchant: string, cursor?: string, signal?: AbortSignal) =>
    request<PaymentPage<Payment>>(
      `/merchants/${merchant}/payments?${new URLSearchParams({ limit: "20", ...(cursor ? { cursor } : {}) })}`,
      { signal },
    ),
  summary: (merchant: string, signal?: AbortSignal) =>
    request<PaymentSummary>(`/merchants/${merchant}/payments/summary`, {
      signal,
    }),
};

export const REQUEST_CREATE_KEY = "nexapay.request-create";
const CREATE_KEY = REQUEST_CREATE_KEY;
export interface CreateReference {
  actor: string;
  merchant: string;
  epoch: string;
  key: string;
}
let createDraft: { ref: CreateReference; body: CreateRequest } | null = null;
export function readCreate(
  actor: string,
  merchant: string,
  epoch: string,
): CreateReference | null {
  try {
    const value: unknown = JSON.parse(
      sessionStorage.getItem(CREATE_KEY) ?? "null",
    );
    if (
      value &&
      typeof value === "object" &&
      "actor" in value &&
      value.actor === actor &&
      "merchant" in value &&
      value.merchant === merchant &&
      "epoch" in value &&
      value.epoch === epoch &&
      "key" in value &&
      typeof value.key === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value.key,
      )
    )
      return { actor, merchant, epoch, key: value.key };
  } catch {
    /* Invalid or cross-context reference is discarded. */
  }
  sessionStorage.removeItem(CREATE_KEY);
  return null;
}
export function saveCreate(ref: CreateReference, body: CreateRequest) {
  sessionStorage.setItem(CREATE_KEY, JSON.stringify(ref));
  createDraft = { ref: structuredClone(ref), body: structuredClone(body) };
}
export function readCreateDraft(ref: CreateReference) {
  return createDraft &&
    Object.keys(ref).every(
      (k) =>
        ref[k as keyof CreateReference] ===
        createDraft!.ref[k as keyof CreateReference],
    )
    ? structuredClone(createDraft.body)
    : null;
}
export function clearCreate() {
  createDraft = null;
  sessionStorage.removeItem(CREATE_KEY);
}

export function retainCreateDraft(actor: string | null) {
  if (createDraft?.ref.actor !== actor) createDraft = null;
}
