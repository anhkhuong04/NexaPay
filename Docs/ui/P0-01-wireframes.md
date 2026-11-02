# P0-01 — Wireframes và interaction contract

Ngày 02/11/2026. Phạm vi: UI-01/02/03/08; thiết kế cho identity/wallet theo baseline v0.2.

```text
Landing desktop: brand + login/signup | headline + CTA | illustrative demo card
Auth desktop: branded introduction | labelled form + inline/root error + submit
Wallet desktop: left workspace nav | header/account | balance card + onboarding note
                                       | wallet identity + simulation notice
Mobile: compact header, stacked content, two visible account navigation destinations
Profile: own email (read only), editable display name, save result, logout
```

- Teal/mint và FluentProvider semantic tokens theo UI Spec; mint không làm body text trên trắng.
- Landing illustration luôn có nhãn minh họa; overview chỉ dùng API thực.
- Signup success tới sign-in; login success tới overview/allowlisted intended route.
- Invalid/duplicate registration, generic login failure, throttle, session expiry và network error có copy riêng; không reset input khi validation lỗi.
- Loading wallet dùng status/skeleton, không show 0; lỗi có retry và không giả số dư. LOCKED vẫn đọc ví, không có money action trong slice.
- Profile save có feedback, email read-only. Logout/account transition cancel và clear cache; request cũ không được ghi sang account mới.
- Màn hình 390/1440px, reflow 320px, zoom 200%, keyboard/focus và axe được kiểm tra trên rendered app. Password manager/paste được cho phép.

Đây là wireframe/behavior trước khi nối API; screenshots/test reports chỉ được ghi nhận sau chạy thực tế. Chưa có funding/transfer/history buttons hoặc transaction fixtures trong runtime.
