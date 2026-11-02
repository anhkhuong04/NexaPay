# NexaPay — Project Context v0.2

**Trạng thái:** ACCEPTED — baseline thiết kế theo ủy quyền của chủ dự án ngày 01/11/2026  
**Ngày:** 01/11/2026  
**Loại tài liệu:** Product & Technical Context (high-level)  
**Mục tiêu:** Thống nhất bối cảnh cho người phát triển và AI coding agent trước khi phân tích yêu cầu chi tiết hoặc viết code.

> Baseline này chốt hướng triển khai, không xác nhận code hoặc kiểm thử đã hoàn thành. [ADR-001](adr/ADR-001-project-baseline.md) ghi quyết định và trade-offs; [Money Movement Spec](NexaPay_MONEY_MOVEMENT_SPEC_v0.2.md) chốt quy tắc tiền/recovery. PRD là nguồn phạm vi/FR/BR; Architecture là cấu trúc thực thi; UI/UX không tự thay đổi nghiệp vụ.

**Bộ tài liệu:** [PRD](NexaPay_PRD_v0.1.md), [Architecture](NexaPay_SYSTEM_ARCHITECTURE_v0.1.md), [UI/UX](NexaPay_UIUX_DESIGN_SPEC_v0.1.md). Giữ tên file `_v0.1` của ba tài liệu để các link hiện có không hỏng; version nội dung hiện tại là v0.2.

## 1. Tổng quan

**Tên làm việc:** NexaPay  
**Mô tả ngắn:** Nền tảng ví điện tử và thanh toán trực tuyến **mô phỏng**, cho phép cá nhân quản lý số dư và chuyển tiền, merchant tạo yêu cầu thanh toán, và quản trị viên giám sát hoạt động hệ thống.

**Hình thức:** Full-stack web application (responsive), API-first. Giai đoạn đầu **không có ứng dụng mobile native**; backend được thiết kế để có thể tái sử dụng cho mobile trong tương lai.

**Định vị:** Sản phẩm portfolio mang trải nghiệm thực tế, lấy cảm hứng từ các chức năng cơ bản của ví điện tử và payment platforms như MoMo/PayPal nhưng không sao chép thương hiệu, không kết nối tiền thật và không cung cấp dịch vụ tài chính được cấp phép.

**Mục tiêu kép:**
1. Tạo một ứng dụng thực sự dùng được trong môi trường demo, UI/UX có tính nhất quán và hoàn chỉnh.
2. Thể hiện năng lực Middle Java/Full-stack Software Engineer cho CV và phỏng vấn năm 2027, nhất là backend architecture, data consistency, testing, security và operations.

**Giá trị cốt lõi cần chứng minh:** Giao dịch đáng tin cậy, không ghi nhận tiền hai lần, có thể tra cứu và đối soát, trải nghiệm người dùng rõ ràng.

## 2. Đối tượng sử dụng và nhu cầu

| Vai trò | Nhu cầu chính | Khu vực giao diện |
|---|---|---|
| **Individual User** | Quản lý ví, chuyển tiền cho người khác, thanh toán đơn hàng, xem lịch sử | **NexaPay Wallet** |
| **Merchant** | Tạo yêu cầu thanh toán, nhận tiền mô phỏng, xem giao dịch/doanh thu, hoàn tiền | **NexaPay Business** |
| **System Admin / Operator** | Quản lý tài khoản, kiểm tra trạng thái giao dịch, xử lý cảnh báo, xem audit và đối soát | **NexaPay Console** |
| **Developer tích hợp** (giai đoạn sau) | Dùng API/payment webhooks để tích hợp cửa hàng demo | **NexaPay API** |

Ba khu vực giao diện triển khai trong **một ứng dụng React** theo route và resource permission. Một user có một ví cá nhân, có thể đồng thời sở hữu một merchant với ví riêng; merchant P1 có một owner, chưa có staff/multi-merchant. Không có public signup ADMIN.

## 3. Những trải nghiệm người dùng chính (high-level journeys)

1. **Đăng ký và tạo ví:** Người dùng dùng email giả/password -> validation -> tạo account và ví mặc định 0 VND -> đăng nhập -> dashboard; P0 không gửi email verification.
2. **Chuyển tiền P2P:** Người dùng chọn người nhận -> nhập số tiền -> xác nhận -> backend xử lý giao dịch -> hai ví cập nhật -> lịch sử và thông báo hiển thị.
3. **Thanh toán merchant:** Merchant tạo payment request -> người dùng mở link/QR demo -> xác nhận -> hệ thống chuyển tiền giữa các ví nội bộ -> merchant nhận kết quả.
4. **Nạp/rút mô phỏng:** Người dùng yêu cầu nạp/rút -> mock bank/provider xác nhận hoặc trả lỗi/timeout -> trạng thái và sổ cái được cập nhật theo quy tắc.
5. **Quản trị và đối soát:** Admin truy vấn sự kiện/giao dịch, xem audit trail, phát hiện các khoản lệch số dư và theo dõi việc xử lý.

## 4. Phạm vi chức năng theo ưu tiên

### P0 — MVP bắt buộc

- **Authentication & Authorization:** email/password + Spring Security session cookie cùng origin; đăng ký, đăng nhập, đăng xuất, sửa display name; RBAC/ownership server-side. P0 chỉ mở Individual UI, Admin role cấp ngoài public signup.
- **Wallet:** một ví cá nhân VND mô phỏng, số dư ban đầu 0, ACTIVE/LOCKED; khóa không ngăn xem lịch sử.
- **Demo funding:** preset 100.000 VND/lần, quota 500.000 VND/user/ngày UTC và 50.000.000 VND/môi trường/ngày UTC; nguồn DEMO_ISSUANCE có bút toán đối ứng.
- **P2P Transfer:** xác định người nhận, nhập số tiền, kiểm tra hợp lệ, xác nhận, thực hiện chuyển tiền, tra cứu kết quả.
- **Ledger & Transaction History:** ghi nhận bút toán kép, trạng thái giao dịch, lịch sử có lọc và phân trang.
- **Financial correctness:** xử lý đồng thời, kiểm soát số dư không âm, rollback đúng, idempotency cho yêu cầu chuyển tiền.
- **User UI:** dashboard, trang chuyển tiền, lịch sử/chi tiết giao dịch, responsive.
- **Quality baseline:** migrations, lỗi API nhất quán, audit bền vững từ P0, CI/unit/integration/E2E và reconciliation CLI/test chỉ đọc; không đợi dashboard P2 mới kiểm tra ledger/balance.

### P1 — Ba đợt có thể nghiệm thu độc lập

| Đợt | Phạm vi bắt buộc |
|---|---|
| **P1a — Merchant Payments** | Merchant owner + ví riêng, payment request/link/QR nội bộ, nhiều attempts nhưng tối đa một payment thành công, full/partial refund đồng bộ; merchant thiếu tiền thì FAILED |
| **P1b — Operations & Delivery** | DB outbox + polling dispatcher, notification/webhook có ký/dedup/retry, Console investigation/lock/audit, export CSV, public demo nếu đủ ngân sách |
| **P1c — Mock Banking** | Deposit/withdraw qua provider giả lập, hold/settle/release, duplicate/out-of-order callbacks, NEEDS_REVIEW cho pending lâu hoặc dữ liệu mâu thuẫn |

P1 hoàn chỉnh nghĩa là đủ P1a/b/c; không yêu cầu hoàn tất cả ba để demo một đợt đã đạt gate. Public deployment có thể làm sau P0; không là lý do mở rộng tính năng trước correctness.

### P2 — Nâng cao (chỉ thực hiện nếu P0/P1 đạt chất lượng)

- **Reconciliation dashboard** và cảnh báo số liệu lệch.
- **Rule-based fraud signals** và UI quản lý hạn mức; giới hạn backend cơ bản có ngay P0.
- **Performance/load tests**, metrics/traces, dashboard vận hành.
- **API tích hợp merchant** hoàn chỉnh, developer docs, sandbox key.
- **Mobile/PWA** và các tính năng UX nâng cao.

## 5. Ranh giới phạm vi / Non-goals

- **Không xử lý tiền thật** và không kết nối ngân hàng/đơn vị trung gian thanh toán thật ở các phiên bản portfolio.
- Không lưu số thẻ thật, thông tin định danh nhạy cảm hoặc dữ liệu tài chính của người dùng thật.
- Không tuyên bố hệ thống được cấp phép cung cấp dịch vụ thanh toán hoặc đáp ứng một chuẩn tuân thủ chuyên ngành khi chưa kiểm chứng độc lập.
- Không cần KYC/eKYC thật, AML sản xuất, đa tiền tệ, chuyển tiền quốc tế hay settlement ngoài hệ thống.
- Không bắt buộc microservices, Kubernetes, machine learning fraud detection hoặc native mobile trong MVP.
- Không dùng admin để sửa/xóa trực tiếp ledger; điều chỉnh tiền phải qua nghiệp vụ có audit/bút toán bù.

## 6. Kiến trúc định hướng

- **Frontend:** React single-page application, có ba không gian theo role: Wallet, Business, Console.
- **Backend:** Java Spring Boot, REST API; API-first và OpenAPI; module hóa rõ ràng theo nghiệp vụ.
- **Kiến trúc ban đầu:** **Modular Monolith** với một PostgreSQL database. Các thay đổi số dư và bút toán nội bộ cùng một database transaction.
- **Modules:** Identity/Profile; Wallet; Ledger; Transfer; Demo Funding; Audit ở P0; Merchant/Payment/Refund, Notification/Administration, Mock Banking thêm theo P1a/b/c. Không tạo sẵn layers rỗng.
- **Money ownership:** LedgerAccount tách Wallet metadata; ledger module là đường duy nhất post entries và balance projection trong transaction của use-case. Customer không âm; system issuance/clearing được signed theo quy tắc riêng.
- **Event-driven:** P1b dùng **DB Transactional Outbox + polling dispatcher** trong cùng ứng dụng; at-least-once, consumer dedup. Không Kafka/RabbitMQ/Modulith event registry trong baseline.
- **Concurrency/recovery:** READ COMMITTED + row lock theo thứ tự toàn hệ thống, DB constraints/commit guards, idempotency DB-backed và lookup theo actor/operation/key trước khi client biết transaction ID.
- **Consistency:** PostgreSQL là source of truth cho tiền/số dư/ledger; cache không có thẩm quyền quyết định số dư.
- **Evolution:** chỉ tách service khi có lý do cụ thể và đánh giá được chi phí về distributed consistency/operations.

## 7. Tech stack đã chốt (pin phiên bản khi scaffold)

| Lớp | Lựa chọn | Ghi chú |
|---|---|---|
| Frontend | **React + TypeScript + Vite** | Web-first, responsive |
| UI/UX | **Fluent UI React v9** + custom design tokens/CSS | Định hướng Fluent 2 Design System kết hợp Modern Fintech Minimalism |
| Data fetching/forms | TanStack Query, React Hook Form, Zod | Query keys có actor/workspace, xóa cache khi logout |
| Backend | **Java 21 LTS + Spring Boot** stable tương thích | Pin phiên bản ổn định lúc scaffold |
| Web/API | Spring Web, Spring Validation, OpenAPI | REST với validation, pagination, versioning nhất quán |
| Security | Spring Security session cookie + CSRF | Một instance, same-origin; HttpOnly/Secure/SameSite=Lax; không JWT/OIDC baseline |
| Persistence | **PostgreSQL + Spring Data JPA + Flyway** | Java long/DB BIGINT theo VND nguyên; JSON money là string; overflow checks |
| Rate limiting | In-memory cho demo một instance | Quota nghiệp vụ/idempotency nằm ở DB; Redis ngoài baseline |
| Async | DB outbox + polling dispatcher P1b | Retry/backoff/dedup; không broker |
| Testing | **JUnit 5, Mockito, Testcontainers; frontend Vitest/Playwright** | Integration/concurrency tests ưu tiên cao |
| Deployment | **Docker Compose**, GitHub Actions; hosting phù hợp ngân sách | Trước tiên chạy local ổn định, sau mới cloud |
| Observability | Spring Boot Actuator, Micrometer, Prometheus/Grafana (P2) | Logs tránh lộ token/dữ liệu nhạy cảm |

**Chú ý:** Không đưa toàn bộ công nghệ vào cùng lúc để tránh overengineering. Stack chỉ thực sự được chọn khi phục vụ một mục tiêu cụ thể.

## 8. Định hướng sản phẩm và UI/UX

- **Brand đang đề xuất:** NexaPay (chưa tra cứu nhãn hiệu/tên miền), logo ngang và app icon đã được phác thảo.
- **Phong cách:** Modern Fintech Minimalism, sắc **Deep Teal `#102E37`**, **Mint `#5FE0C2`**, nền sáng trung tính; giao diện tin cậy và không rối mắt.
- **Hệ thống thiết kế:** typography, color tokens, spacing, trạng thái loading/empty/error/success, iconography và components dùng lại.
- **Ưu tiên UX:** số dư và trạng thái rõ ràng; trước khi xác nhận chuyển tiền phải kiểm tra người nhận/số tiền; lỗi giải thích dễ hiểu; giao dịch pending không được trình bày như đã thành công.
- **Responsive và accessibility:** desktop tốt cho admin/merchant, mobile web tốt cho individual; tiếng Việt, light theme, mục tiêu WCAG 2.2 AA; keyboard/focus/contrast/accessible auth được kiểm chứng.
- **Trình bày dữ liệu:** tiền bằng VND có format nhất quán; ngày/giờ hiển thị theo múi giờ người dùng, lưu timestamp chuẩn ở backend.

## 9. Yêu cầu chất lượng cấp dự án

1. **Correctness first:** không mất/nhân đôi tiền trong nghiệp vụ nội bộ; bút toán cân bằng; không chuyển vượt số dư hợp lệ.
2. **Security by design:** mật khẩu được hash an toàn, phân quyền server-side, kiểm tra ownership, không log secret, xử lý rủi ro CSRF/XSS phù hợp kiến trúc auth.
3. **Reliability:** retry an toàn với idempotency; không làm thay đổi trạng thái sai khi timeout/duplicate request.
4. **Observability:** đủ trace/log/audit để tái dựng luồng xử lý mà không lộ dữ liệu nhạy cảm.
5. **Testability:** đặc biệt có automated integration tests cho rollback, concurrency, duplicate submissions, payment state changes.
6. **Maintainability:** module rõ ràng, docs ngắn nhưng nhất quán, code review và CI build/test.
7. **Demoability:** local Docker/CI trước, seed qua nghiệp vụ funding, public demo sau quality gate; kịch bản success/failure/timeout/concurrency và tài liệu chứng minh kết quả thực tế.

## 10. Quy trình triển khai và quản lý tài liệu

1. Bắt đầu P0 vertical slice signup → ví 0 → funding → transfer → history/recovery, kèm tests trên PostgreSQL thật.
2. Trước code từng slice: viết Flyway DDL, OpenAPI và acceptance tests tương ứng với FR/BR và Money Movement Spec. Không cần thiết kế toàn bộ P1 mới được bắt đầu P0.
3. Không yêu cầu phê duyệt lại baseline Accepted; thay đổi đáng kể lập ADR mới. Visual measurements/logo exports được kiểm chứng qua prototype, không thay money rules.
4. Ngân sách, số giờ/tuần và hạn portfolio chưa được cung cấp; không tự cam kết host trả phí/ngày release. Build local không phụ thuộc các thông tin này.

## 11. Changelog

- **v0.2 — 2026-11-01:** Chốt stack/auth/money/account ownership; thêm funding/quota/audit/reconciliation P0; chia P1a/b/c; chọn DB outbox không broker; bổ sung ADR và Money Movement Spec; chuẩn hóa link tài liệu. Quyết định theo yêu cầu chủ dự án, chưa phải báo cáo hoàn thành phần mềm.

---
