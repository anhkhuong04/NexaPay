# P1a-03 — Refund interaction states

**02/11/2026 — Implementation prototype; verification evidence trong [plan](<../../Implementation Plan/P1a-03-refunds.md>).**

Routes: `/business/payments/:id/refund`, `/business/refunds`, `/business/refunds/:id`.
Payment detail giữ PAID, hiển thị original/refunded/remaining và NONE/PARTIAL/FULL.

```text
Paid request / received payment → [Hoàn tiền]
Original amount / refunded / remaining / payer / merchant wallet
[Hoàn toàn bộ phần còn lại] hoặc [Số tiền một phần] [Lý do optional]
→ [Xem lại hoàn tiền] → original / remaining / amount / fee / source / payer
→ [Xác nhận hoàn tiền] → pending → authoritative receipt SUCCEEDED / FAILED
                                  ↘ lost response → UNKNOWN → lookup / manual same-key retry
```

| State | Behavior |
|---|---|
| Loading/error | Đọc server payment/capabilities/wallet, retry GET; không fake0 |
| Form/review | Canonical amount; explicit full remaining, original payer không sửa được; không POST trước confirm |
| Locked/full | Merchant locked hoặc remaining0 chặn intent mới, vẫn lookup intent cũ; payer locked không chặn refund |
| Pending/unknown | Reference actor/epoch/merchant/payment/key lưu trước POST; memory-only payload, bounded GET observation, không auto POST |
| Reauth/reload | Same actor reauth giữ reference, lookup trước; reload mất payload nên lookup-only; actor khác/logout xóa context |
| Success/failed | Receipt có refund/payment IDs, amount/time/error; no optimistic balances. Intent mới chỉ sau terminal |
| History/detail | Owned failed+successful refunds, status filter/keyset; payer chỉ successful incoming refund trong personal history |

Fluent UI v9/Fluent 2 và NexaPay tokens; 44px controls, semantic forms, keyboard/focus,
320px reflow/200% CSS zoom, axe và visual QA. Refund summary theo ngày UTC, không
đổi gross received thành net balance. Data/permissions chỉ server quyết định.
