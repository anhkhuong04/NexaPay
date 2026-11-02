import { z } from "zod";
import { ApiError, mutate, request, type Wallet } from "./api";
export interface Merchant {
  id: string;
  displayName: string;
  status: "ACTIVE" | "LOCKED";
  createdAt: string;
  updatedAt: string;
}
export const merchantKey = (actorId: string) =>
  ["merchant", actorId, "business"] as const;
export const merchantWalletKey = (actorId: string, merchantId: string) =>
  ["wallet", actorId, "business", merchantId] as const;
export const merchantName = z
  .string()
  .refine(
    (v) =>
      ![...v].some((c) => {
        const n = c.codePointAt(0)!;
        return n < 32 || (n >= 127 && n <= 159);
      }),
    "Tên không được chứa ký tự điều khiển.",
  )
  .transform((v) => v.trim().normalize("NFC"))
  .refine(
    (v) => [...v].length >= 1 && [...v].length <= 80,
    "Tên doanh nghiệp cần 1–80 ký tự.",
  );
export const merchantSchema = z.object({ displayName: merchantName });
export const merchantApi = {
  own: async (signal?: AbortSignal): Promise<Merchant | null> => {
    try {
      return await request<Merchant>("/merchants/me", { signal });
    } catch (e) {
      if (
        e instanceof ApiError &&
        e.status === 404 &&
        e.code === "MERCHANT_NOT_FOUND"
      )
        return null;
      throw e;
    }
  },
  onboard: (displayName: string) =>
    mutate<Merchant>("/merchants", "POST", { displayName }),
  rename: (id: string, displayName: string) =>
    mutate<Merchant>(`/merchants/${id}`, "PATCH", { displayName }),
  wallet: (id: string, signal?: AbortSignal) =>
    request<Wallet>(`/merchants/${id}/wallet`, { signal }),
};
