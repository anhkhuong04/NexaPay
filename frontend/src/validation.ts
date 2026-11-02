import { z } from "zod";

export const displayName = z
  .string()
  .trim()
  .min(1, "Vui lòng nhập tên hiển thị.")
  .refine(
    (v) =>
      [...v].length <= 80 &&
      [...v].every((c) => {
        const point = c.codePointAt(0)!;
        return point >= 32 && (point < 127 || point > 159);
      }),
    "Tên tối đa 80 ký tự, không chứa ký tự điều khiển.",
  );
const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email("Email chưa đúng định dạng.");
export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Vui lòng nhập mật khẩu.").max(128),
});
export const registerSchema = z
  .object({
    email,
    displayName,
    password: z
      .string()
      .refine(
        (v) =>
          [...v].length >= 12 &&
          [...v].length <= 64 &&
          new TextEncoder().encode(v).length <= 72,
        "Mật khẩu cần 12–64 ký tự và tối đa 72 byte UTF-8.",
      ),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Mật khẩu xác nhận chưa khớp.",
  });

export function formatMoney(value: string) {
  if (!/^(0|[1-9][0-9]*)$/.test(value))
    throw new Error("Invalid canonical VND");
  return `${new Intl.NumberFormat("vi-VN").format(BigInt(value))} ₫`;
}
