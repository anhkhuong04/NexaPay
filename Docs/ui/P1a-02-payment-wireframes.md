# P1a-02 — Payment Request & Checkout states

**02/11/2026 — VERIFIED local + hosted CI; execution evidence trong [slice plan](<../../Implementation Plan/P1a-02-payment-checkout.md>).**

Routes: `/business/payment-requests`, `/business/payment-requests/new`,
`/business/payment-requests/:id`, `/business/transactions`, public `/pay/:ref`.
Fluent UI React v9/Fluent 2 và NexaPay tokens; controls min44px, money strings,
không editable amount trên checkout. Refund là P1a-03.

| Screen | Loading/empty | Success | Error/recovery |
|---|---|---|---|
| Create | Capabilities server + form amount/description/expiry | 201 → detail, same-origin link và QR | Validation giữ form; mất response/401 giữ creation key trước POST, GET by-key trước retry; memory draft cho manual same-key retry, reload chỉ lookup |
| Requests | Owner list, status filter, keyset next page, empty message | Status/amount/time, link detail | Retry GET; unrelated merchant/resource trả safe404 |
| Detail/share | Owned query loading | PENDING link/QR/copy và cancel confirmation; PAID paymentId/payerName/paidAt (ledgerId có trong owned API) | EXPIRED/CANCELLED không cancel/pay; về list để tạo request mới; cancel lỗi refetch current state vì có thể đã commit |
| Business Overview/payments | Queries loading, không fake0 | Ví merchant riêng; paid today/received today UTC, pending còn hạn, recent captures; paginated successful captures | Retry GET; không expose failed payer attempts, không có refund KPI/CTA giả |
| Public checkout | Minimal public DTO, session loading | Merchant snapshot, fixed amount/description/expiry/status, login link giữ exact local route | Missing/retry; terminal status không pay; login không tự gửi money POST |
| Auth checkout | Personal wallet và capabilities | Preview → explicit review → confirm; phí0, amount tổng trừ, source wallet, current balance | LOCKED/refreshed terminal disable confirm; insufficient là stored FAILED attempt, request còn PENDING nếu còn hạn |
| Result/recovery | Pending khi POST; GET observation có giới hạn | PAYMENT receipt và history detail; start new intent chỉ sau terminal | Timeout/404 lookup là UNKNOWN, giữ key; retry thủ công cùng key/payload khi còn memory; reload lookup-only; re-auth same actor giữ reference và lookup trước |

```text
BUSINESS / TẠO YÊU CẦU
[Số tiền] [Mô tả] [Thời hạn] → [Tạo yêu cầu]
  → CHỜ THANH TOÁN: amount / expires / [QR] / [Copy link]
    [Hủy yêu cầu] → confirmation → CANCELLED
    hoặc payer capture → PAID + payment reference

PUBLIC /pay/opaque-ref
merchant + fixed amount + description + status + expiry + demo
  → [Đăng nhập để thanh toán] → cùng route
  → personal balance → [Xem lại thanh toán]
  → merchant / amount / fee / source / balance → [Xác nhận thanh toán]
  → pending → SUCCEEDED receipt hoặc FAILED attempt
             ↘ response loss → UNKNOWN → GET lookup / manual same-key retry
```

Reference PAYMENT có actor/epoch/operation/key/checkoutRef; không lưu amount/note
hoặc full payload trong storage. Metadata creation dùng reference riêng và cùng
chính sách memory-only payload. Auth transition clear/cancel actor cache; logout/
đổi actor xóa references, re-auth cùng actor giữ để lookup. Một late payment
response vẫn invalidates wallet/history/checkout khi cùng actor sau khi rời trang;
không cập nhật actor mới. Cross-screen funding/P2P/checkout không bỏ qua intent
chưa rõ kết quả; link dẫn về thao tác gốc, không auto POST.

QR tạo tại browser, encode exact same-origin `/pay/:ref`, không external QR API,
secret hoặc session token. Connected E2E decode ảnh thực bằng decoder độc lập,
keyboard confirm, axe, screenshot desktop/mobile và 320px reflow. Các checks là
bằng chứng cho journeys đã chạy, không phải chứng nhận accessibility tổng thể.
