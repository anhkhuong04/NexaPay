# P0-02 — Funding và recovery

**Implementation prototype:** theo UI-04/command recovery; không mock số dư runtime.

Desktop dùng AppShell hiện có; mobile một cột, controls wrap ở 320 CSS px.

1. `/app/add-demo-funds`: heading “Nhận tiền demo”, disclaimer, preset và quota
   user/môi trường/reset local lấy từ capabilities. Loading/error/retry riêng.
   Disabled/quota exhausted/LOCKED chặn intent mới, vẫn cho lookup cũ.
2. Bấm tiếp tục → review trong trang với amount/currency + ví đích, disclaimer → xác nhận.
   Chỉ confirm tạo UUID intent và reference. Processing khoá submit.
3. Receipt terminal: resource ID/status/amount/time; server error hiển thị cụ thể;
   refetch wallet/quota sau terminal, không coi payload replay là current balance.
4. Timeout/network/503/401/CSRF: UNKNOWN, giữ key; “Kiểm tra kết quả” GET.
   404 giải thích chưa quan sát được, không báo thất bại. Cùng tab có thể retry
   đúng key/payload; reload chỉ lookup và không tự POST. Re-auth cùng actor tra
   recent commands; account switch/logout không lộ reference actor cũ.
5. `/app/commands`: actor-scoped committed receipts, cursor “Xem thêm”, chọn
   receipt đọc kết quả. Empty/loading/error/refresh; không giả history P2P.

Review dùng section có accessible name và focus vào “Quay lại”; không cần focus trap.
Form, status và lỗi có semantic labels/live region; review/result có heading,
keyboard focus và CTA rõ. Dùng Fluent UI v9 + theme hiện có, exact money formatter.
