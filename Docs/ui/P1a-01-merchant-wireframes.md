# P1a-01 — Merchant states and ownership

**02/11/2026 — VERIFIED local và hosted CI; evidence trong [slice plan](<../../Implementation Plan/P1a-01-merchant-wallet.md>).**

Routes: `/business/onboarding`, `/business/overview`, `/business/settings`.
Workspace switcher ở sidebar, dùng link có tên hiển thị. Business nav chỉ Overview
và Settings trong slice này; không render payment/refund KPI hoặc CTA giả.

| Screen | Loading/empty | Success | Error/recovery |
|---|---|---|---|
| Onboarding | GET own profile đang tải → spinner; 404 MERCHANT_NOT_FOUND → form tên + disclosure | POST 201 → profile và session refetch, Overview ví merchant 0 | 400 field/root error; 409/500/network → unknown, khóa form, explicit GET check; chỉ confirmed missing mới cho submit lại; 401 → login |
| Business Overview | Query actor/business profile; chưa onboard → CTA | Profile name/status/UUID, OWNER; wallet UUID/status và canonical balance riêng | Profile hoặc wallet error → retry, không fake 0 hoặc show stale balance như current; LOCKED vẫn đọc |
| Settings | Owned query loading/error | Tên merchant editable; role/status/IDs read-only; PATCH response + audit authoritative | 401 → login returnTo settings, không auto retry PATCH; 404 unrelated safe, không show merchant khác |

```text
[Ví cá nhân] [Doanh nghiệp]   (workspace links)
TỔNG QUAN DOANH NGHIỆP
Tên merchant                 Demo / OWNER
┌ Ví doanh nghiệp ──────────── Tải lại ┐
│ Số dư khả dụng · VND mô phỏng       │
│ 0 ₫ [query thật]                    │
│ Trạng thái, mã ví UUID              │
└────────────────────────────────────┘
Hồ sơ merchant / mã / trạng thái / OWNER
[Chỉnh sửa tên doanh nghiệp]
```

Query keys: `['merchant', actorId, 'business']`,
`['wallet', actorId, 'business', merchantId]`; personal keys không đổi. Auth
transition hủy/clear query cache. Late mutation chỉ cập nhật khi actor vẫn hiện tại.
Session summary luôn đọc membership thật, còn API authorize theo membership từng
request. Business balance không thay số dư personal; P2P/funding personal-only.

Keyboard native Fluent form/Enter, labels/hints/role status, route focus theo
RouteFocus hiện có; min44px link/control, UUID/name wrap, 320px reflow. Light
NexaPay tokens/Fluent 2, không thêm UI kit. Gate: connected desktop/mobile axe,
visual, pending/error/session-loss và actor switch evidence nằm trong slice plan.
