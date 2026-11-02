# ADR-001 — NexaPay implementation baseline

**Version:** 0.2  
**Status:** ACCEPTED — quyết định thiết kế theo ủy quyền của chủ dự án ngày 01/11/2026  
**Date:** 2026-11-01  
**Scope:** Portfolio mô phỏng; quyết định này không phải bằng chứng implementation đã hoàn thành.

## 1. Context và quyền quyết định

Chủ dự án yêu cầu phân tích, thống nhất quyết định và sửa tài liệu theo khuyến nghị. ADR này thay các lựa chọn Draft/Proposed của v0.1 trong phạm vi dưới đây. Không cần phê duyệt lại các lựa chọn đã Accepted trước scaffold. Thay đổi nghiệp vụ tiền, quyền hoặc release sau baseline phải có ADR kế tiếp và cập nhật PRD/spec liên quan.

## 2. Decisions

| ID | Quyết định đã chốt | Lý do / hệ quả |
|---|---|---|
| D01 | Modular Monolith; một Spring Boot backend và PostgreSQL | Giữ money-critical writes trong một DB transaction; không microservices |
| D02 | Java 21 LTS; Spring Boot stable tương thích; JPA + Flyway | Pin chính xác phiên bản và dependency lock khi scaffold, không chọn bản preview |
| D03 | React + TypeScript + Vite; Fluent UI React v9; TanStack Query, React Hook Form, Zod | Một SPA với Wallet/Business/Console; frontend không là authority của tiền |
| D04 | Một currency VND mô phỏng; Java `long`, DB `BIGINT`; JSON money là chuỗi số nguyên | Không float/double, không phần lẻ; kiểm tra overflow trước arithmetic và tại DB |
| D05 | LedgerAccount tách khỏi Wallet; signed append-only ledger + balance projection cùng transaction | System account không giả làm user; một nguồn projection, không nhân đôi `Wallet.balance` |
| D06 | Chỉ `ledger` MoneyPostingService được cập nhật ledger và posted balance | Transfer/payment/refund/funding không tự update balance; caller và posting cùng transaction |
| D07 | PostgreSQL READ COMMITTED + row locks theo thứ tự thống nhất; uniqueness và DB guards | Kiểm thử trên PostgreSQL thật; retry cả transaction có giới hạn, cùng key |
| D08 | Idempotency DB-backed; synchronous P0 commit terminal result cùng money writes | Business rejection được lưu; technical rollback không giả tạo FAILED; giữ terminal keys suốt đời dữ liệu demo |
| D09 | Email/password + Spring Security HTTP session, cookie HttpOnly/Secure/SameSite=Lax; cùng origin, CSRF bật | Không JWT/OIDC/Redis P0; session in-memory đủ cho một instance, restart yêu cầu login lại |
| D10 | Một user có một ví cá nhân; có thể sở hữu một merchant với ví riêng; một owner/merchant P1 | Membership OWNER kiểm tra theo resource; không tự cấp ADMIN; chưa có staff/multi-merchant |
| D11 | DEMO_ISSUANCE account khởi tạo 0, được âm theo quy ước signed | Funding có bút toán đối ứng, không cần số dư seed tùy ý; quota DB-backed |
| D12 | P0 có audit nền tảng và reconciliation CLI/test; dashboard đối soát P2 | Phát hiện lệch từ sớm; không cần Console để kiểm tra correctness |
| D13 | P1a merchant/payment/full + partial refund; P1b outbox/webhook/Console/CSV; P1c mock bank | Mỗi đợt có thể nghiệm thu riêng; P1 hoàn chỉnh nghĩa là đủ a/b/c |
| D14 | Refund đồng bộ: đủ số dư merchant thì post; thiếu tiền thì FAILED; không refund pending/debt | Serialize theo payment; khóa ví payer không chặn nhận refund của payment gốc |
| D15 | Withdrawal chuyển tiền sang một system hold account cho mỗi operation trước gọi provider | Available giảm ngay; success settle, failure release; timeout không tự release |
| D16 | DB outbox + polling dispatcher cùng ứng dụng ở P1b; không broker hoặc Modulith event registry song song | At-least-once; delivery ID dedup; tách worker/broker chỉ khi có nhu cầu được đo |
| D17 | Tiếng Việt trước; light theme; WCAG 2.2 AA là mục tiêu nghiệm thu | Fluent tokens/brand cố định về hướng; kích thước và contrast phải kiểm chứng bằng prototype |
| D18 | Local + CI trước; đóng gói một Docker image phục vụ SPA và API cùng origin | Public demo sau P0 gate; chọn host khi biết ngân sách, không tạo tài nguyên trả phí lúc này |

## 3. Defaults đã chốt

Các giá trị sau là baseline cấu hình, không phải thành tích đo được. UI lấy capabilities/limits từ server. Thay default phải cập nhật cấu hình, test và changelog; replay terminal result không tính lại theo cấu hình mới.

| Cấu hình | Giá trị mặc định |
|---|---|
| Money command amount tối đa | `100000000` VND (100 triệu), ngoại trừ funding chỉ nhận preset |
| Customer/merchant total balance tối đa | `1000000000000` VND (1 nghìn tỷ); P0 total=posted, P1c total=available+held; không âm |
| Demo funding preset | `100000` VND/lần |
| Funding quota | `500000` VND/user/ngày UTC; `50000000` VND/môi trường/ngày UTC |
| Transaction fee | `0` VND cho tất cả luồng trong baseline |
| Payment expiry | Default 30 phút; min 5 phút; max 24 giờ; không sửa amount/merchant/expiry sau create |
| HTTP session | Idle 30 phút; absolute lifetime 8 giờ; không remember-me |
| Login throttle | 5 lần thất bại/account/15 phút và 30 lần/IP/15 phút; không khóa account vĩnh viễn |
| Money command throttle | 30 request/phút/actor; quota funding vẫn kiểm soát bằng DB |
| Recipient exact lookup | 30 request/phút/actor; không search danh bạ user |
| P0 deployment | Một backend instance; rate limiter in-memory; scale-out cần ADR session/rate-limit |
| Webhook retry | Tối đa 8 attempts: ngay, +10s, +30s, +2m, +10m, +30m, +2h, +6h; FAILED sau attempt 8 |

## 4. Alternatives và trade-offs

- JWT/OIDC/Keycloak tăng số thành phần và vòng đời credential cần quản lý; session phù hợp browser cùng origin. API-first không buộc phải JWT. Thêm mobile/auth liên kết sau bằng ADR riêng.
- `NUMERIC` chưa cần cho VND nguyên; `BIGINT` đủ khi có giới hạn và overflow checks. JSON string tránh mất chính xác qua JavaScript; không chuyển string sang Number tùy tiện.
- Pessimistic DB locks đơn giản để giải thích và kiểm thử ở quy mô demo; đổi lại throughput bị giới hạn theo hot account. Không dùng Redis lock làm cơ chế đúng tiền.
- Signed ledger ở đây là mô hình sổ cái mô phỏng, không tuyên bố chart of accounts hay kế toán pháp định hoàn chỉnh. DEMO_ISSUANCE âm biểu diễn lượng tiền demo đã phát hành.
- Deferred trigger bảo vệ balanced transaction làm migration phức tạp hơn nhưng bắt lỗi cross-row ở commit. MoneyPostingService và reconciliation vẫn cần thiết.
- Session và throttle in-memory reset sau restart; money records/quota/idempotency ở PostgreSQL không reset. Đây là giới hạn một-instance được chấp nhận cho demo.
- Chưa yêu cầu email verification/password reset/đổi email/đổi password trong P0; đăng ký không gửi email, dùng địa chỉ giả như `alice@example.test`. Không có các control giả trên UI.

## 5. Acceptance trước mở rộng

P0 phải chứng minh transfer/funding atomic, bounded balance, duplicate keys, committed rejection replay, commit-response-loss recovery, locking và reconciliation. P1b phải chứng minh crash giữa publish/ack không mất event; P1c phải chứng minh hold/settle/release đúng một lần và không tự hoàn tiền chỉ vì timeout.

Ngân sách hosting, số giờ/tuần và hạn portfolio là thông tin kế hoạch chưa có; không ngăn triển khai P0 local. Host cụ thể, ngày phát hành, logo vector cuối và dependency versions là công việc tiếp theo, không phải lựa chọn nghiệp vụ còn treo.

## 6. Related documents và technical sources

- [Context](../NexaPay_Context.md), [PRD](../NexaPay_PRD_v0.1.md), [Architecture](../NexaPay_SYSTEM_ARCHITECTURE_v0.1.md), [UI/UX](../NexaPay_UIUX_DESIGN_SPEC_v0.1.md).
- [Money Movement & Recovery](../NexaPay_MONEY_MOVEMENT_SPEC_v0.2.md) là đặc tả chi tiết cho D04–D08/D11/D14/D15.
- [PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html): CHECK thông thường không bảo vệ tổng nhiều dòng.
- [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html): lock order và deadlock handling.
- [Spring Security CSRF](https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html), [Password storage](https://docs.spring.io/spring-security/reference/features/authentication/password-storage.html).
- [JavaScript integer precision](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/MAX_SAFE_INTEGER), [WCAG 2.2](https://www.w3.org/WAI/WCAG22/quickref/).
- [OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html), [Session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).
