# NexaPay — Product Requirements Document (PRD) v0.2

**Trạng thái:** ACCEPTED — baseline theo ủy quyền của chủ dự án ngày 01/11/2026  
**Ngày:** 01/11/2026  
**Chủ dự án:** Cá nhân phát triển với Codex hỗ trợ  
**Tài liệu nền:** [Context](NexaPay_Context.md), [ADR-001](adr/ADR-001-project-baseline.md), [Money Movement Spec](NexaPay_MONEY_MOVEMENT_SPEC_v0.2.md)  
**Mục đích:** Xác định **WHAT/WHY/WHO** của NexaPay trước khi đi vào **HOW** (architecture, ERD, API, code).

> **Baseline v0.2:** Phạm vi và quyết định đã chốt theo yêu cầu chủ dự án. FR/BR là yêu cầu nghiệm thu của release tương ứng, không có nghĩa đã được implementation. ADR ghi lý do; Money Movement Spec chốt behavior chi tiết. Giữ tên file `_v0.1` để bảo toàn link hiện có. Không xử lý tiền thật.

## 1. Executive Summary

**NexaPay** là web application mô phỏng ví điện tử và nền tảng thanh toán cho cá nhân/merchant. Người dùng đăng ký, quản lý ví VND giả lập, chuyển tiền cho nhau và thanh toán yêu cầu từ merchant. Merchant tạo payment requests, xem kết quả và hoàn tiền. Admin theo dõi hoạt động, kiểm tra audit và quản lý tài khoản.

Sản phẩm phục vụ mục tiêu **portfolio ứng tuyển Middle Java/Full-stack Software Engineer năm 2027**, đồng thời phải có UX/UI đủ hoàn chỉnh để demo như một fintech product thực tế. Tiền trong hệ thống chỉ là **số dư mô phỏng**; không tích hợp ngân hàng thật, không thu phí hay xử lý tiền thật.

**Thông điệp sản phẩm:** *Pay simply. Track confidently.* (tagline đề xuất, không bắt buộc).

## 2. Product Vision, Goals và Non-goals

### 2.1 Vision

Một nền tảng thanh toán demo có trải nghiệm đơn giản, minh bạch và đáng tin cậy, nơi mọi thay đổi số dư đều có nguồn gốc và có thể truy vết.

### 2.2 Mục tiêu (Goals)

| ID | Goal | Cách kiểm chứng |
|---|---|---|
| G-01 | Người dùng có thể hoàn tất P2P transfer trên web | End-to-end scenario: A chuyển cho B; cả hai xem kết quả và lịch sử |
| G-02 | Backend bảo toàn tính đúng của tiền mô phỏng | Integration tests: rollback, insufficient funds, duplicate requests, concurrent transfers |
| G-03 | Merchant nhận được payment theo quy trình rõ ràng | Payment request → payer xác nhận → merchant xem paid; callback demo đáng tin cậy |
| G-04 | Admin có thể quan sát và truy vết hành động quan trọng | Tra cứu transaction ID, actor, thời điểm, trạng thái, audit events |
| G-05 | UI/UX thể hiện cảm giác sản phẩm thực tế | Tất cả luồng chính có responsive, validation, loading, empty/error/success states |
| G-06 | Dự án chứng minh năng lực kỹ thuật khi phỏng vấn | Có demo, README, automated tests, kiến trúc và các quyết định kỹ thuật được giải thích |

### 2.3 Không thuộc phạm vi (Non-goals)

- Không xử lý tiền thật, thông tin thẻ thật, KYC/eKYC thật, kết nối ngân hàng thật hoặc thanh toán quốc tế.
- Không yêu cầu native mobile app, microservices, Kubernetes hay ML fraud detection để ra MVP.
- Không xây dựng hệ thống kế toán/settlement thực tế cho nhiều định chế tài chính.
- Không đăng ký kinh doanh dịch vụ thanh toán, không gắn nhãn đã được cấp phép.
- Không công khai dữ liệu thật hoặc cho người ngoài sử dụng số dư giả lập như tiền có giá trị.

## 3. Target Users & Personas

| Persona | Đặc điểm | Job-to-be-done | Pain points cần giải quyết |
|---|---|---|---|
| **U1 — Individual** | Người dùng ví phổ thông | Xem số dư, chuyển tiền, thanh toán an toàn | Nhầm người nhận, không biết giao dịch đang xử lý hay đã xong |
| **U2 — Merchant Owner** | Chủ cửa hàng nhỏ có tài khoản doanh nghiệp demo | Tạo payment request, nhận thanh toán, hoàn tiền | Khó biết đơn hàng đã thanh toán chưa; trạng thái thiếu minh bạch |
| **U3 — Operator/Admin** | Người quản trị hệ thống demo | Tra cứu sự cố, khóa ví, giám sát và đối soát | Không có audit, khó tìm giao dịch, không biết nguyên nhân lỗi |
| **U4 — Demo Integrator** (P2) | Developer dùng sandbox API | Tạo payment qua API, nhận webhook | Retry gây lặp, khó kiểm thử callback |

### 3.1 Roles và nguyên tắc phân quyền

- **INDIVIDUAL:** chỉ thao tác với ví và các giao dịch thuộc quyền sở hữu hoặc mình là bên liên quan.
- **MERCHANT:** quản lý merchant account/requests/payments/refunds của chính mình; không xem dữ liệu merchant khác.
- **ADMIN:** quan sát, tra cứu và thực hiện tác vụ được ủy quyền; **không thể tự ý chỉnh sửa ledger hoặc đặt số dư tùy ý**.
- Một user có một ví cá nhân, đồng thời có thể sở hữu một merchant và ví merchant riêng. P1 chỉ có một OWNER/merchant và một merchant/user; membership/resource ownership quyết định quyền, không chỉ global role. Self-onboarding tạo merchant ACTIVE mô phỏng; không phê duyệt KYC, không staff.
- ADMIN chỉ được cấp qua bootstrap có cấu hình riêng; public signup không nhận role/merchant owner từ client. P0 chỉ mở personal workspace, P1a mới mở business.
- API luôn kiểm tra permission và resource ownership tại backend; ẩn menu trên frontend không đủ làm biện pháp bảo mật.

## 4. Scope & Release Strategy

| Release | Bắt buộc để nhận release | Không bao gồm trong release |
|---|---|---|
| **P0 — Wallet MVP** | Session auth, wallet, funding/quota, P2P, history/recovery, audit nền tảng, reconciliation CLI, CI/tests/user portal | Merchant, mock bank, broker, Console UI |
| **P1a — Merchant Payments** | Merchant owner/wallet, request/link/QR, attempts/payment, full và partial refund đồng bộ | Webhook/Console/mock bank |
| **P1b — Operations & Delivery** | DB outbox/polling, notification/webhook, Console/lock/audit investigation, export CSV; public demo nếu đủ điều kiện | Broker, mock bank |
| **P1c — Mock Banking** | Deposit/withdraw, hold/settle/release, callback inbox, pending/review/recovery | Ngân hàng thật, merchant withdrawal |
| **P2 — Engineering Extensions** | Chọn lọc: reconciliation dashboard, fraud rules/limits UI, load tests/traces, developer API, PWA/dark mode | Không cam kết tất cả tính năng P2 |

**Thứ tự bắt buộc:** P0 → P1a → P1b → P1c theo vertical slices end-to-end. P1 hoàn chỉnh nghĩa là đủ a/b/c, mỗi đợt có gate riêng. P0 đã có backend limits, audit và reconciliation; P2 chỉ bổ sung giao diện/năng lực nâng cao. Public deployment có thể thực hiện sau P0 gate, không chờ đủ P1c.

## 5. Core User Journeys

### J-01: Onboarding & Wallet

1. Visitor vào website → tạo tài khoản bằng email giả (ví dụ `alice@example.test`)/password. P0 không gửi email verification, không KYC.
2. Hệ thống xác nhận thông tin hợp lệ → người dùng đăng nhập.
3. Ví VND được tạo mặc định với số dư **0 VND**.
4. Người dùng có thể nhận tiền demo theo cơ chế **Demo Funding** (mục 7.3).
5. Dashboard hiển thị số dư, giao dịch gần đây và các CTA quan trọng.

### J-02: P2P Transfer

1. User A chọn "Chuyển tiền", nhập mã ví/định danh người nhận và số tiền.
2. Web hiển thị tên hiển thị của B, số tiền, thông tin cần xác nhận; không tiết lộ dữ liệu không cần thiết.
3. A xác nhận; hệ thống xử lý và trả trạng thái đáng tin cậy.
4. Nếu thành công: số dư A giảm, B tăng bằng cùng số tiền; có transaction record và ledger entries.
5. Nếu lỗi: giao diện hiển thị lý do phù hợp; người dùng có thể xem trạng thái trước khi gửi lại.

### J-03: Merchant Payment [P1a]

1. Merchant tạo Payment Request với số tiền, mô tả, thời hạn hiệu lực.
2. Merchant nhận payment link/QR nội bộ NexaPay.
3. Individual đăng nhập, xem merchant và số tiền, rồi xác nhận.
4. Wallet/ledger cập nhật; payment chuyển `PAID` một lần duy nhất.
5. Merchant thấy trạng thái ngay qua query/refetch; notification/webhook được thêm ở P1b, không chặn nghiệm thu P1a.

### J-04: Refund [P1a]

1. Merchant chọn payment thành công và gửi yêu cầu hoàn tiền.
2. Hệ thống kiểm tra quyền, số tiền đã hoàn và điều kiện hoàn.
3. Tạo refund record và bút toán đảo chiều; kết quả hiển thị cho merchant và payer.
4. Nếu hoàn không đủ điều kiện, không thay đổi số dư; lý do được ghi nhận.

### J-05: Mock Bank Deposit/Withdrawal [P1c]

1. Người dùng tạo yêu cầu nạp/rút tiền mô phỏng.
2. Mock provider có thể trả thành công/thất bại/đang xử lý/timeout.
3. Deposit chỉ ghi có sau provider success; withdrawal giảm available ngay khi accept bằng bút toán sang hold account, sau đó settle hoặc release theo provider result. Timeout giữ hold.
4. Retry/callback lặp không dẫn đến nhân đôi tiền.

### J-06: Admin Investigation [P1b]

1. Admin tìm transaction theo ID, thời gian, trạng thái hoặc tài khoản.
2. Xem lịch sử trạng thái, audit, đối tượng liên quan và các lỗi xử lý phù hợp quyền.
3. Có thể khóa ví theo nghiệp vụ có lý do và audit; không chỉnh sửa ledger trực tiếp.

## 6. Functional Requirements Catalog

**Quy ước:** `P0` MVP; `P1` product complete; `P2` optional. `Must` là bắt buộc trong release đã chọn, không phải bắt buộc ngay lúc scaffold.

| ID | Priority | Requirement | Actor |
|---|---|---|---|
| FR-A01 | P0 Must | Đăng ký bằng email/password; validate và phát hiện email trùng | Visitor |
| FR-A02 | P0 Must | Đăng nhập/đăng xuất, access control và protected routes | User/All |
| FR-A03 | P0 Must | Xem hồ sơ, sửa display name; email chỉ đọc, chưa có đổi/reset password/email | Individual |
| FR-A04 | P0 Must | Backend enforce RBAC/ownership trên mọi API được bảo vệ | All |
| FR-W01 | P0 Must | Tự động tạo ví VND số dư ban đầu 0 khi account active | Individual |
| FR-W02 | P0 Must | Xem số dư, trạng thái ví, activity gần nhất | Individual |
| FR-W03 | P0 Must | Từ chối money intent mới với ví khóa; nhận refund gốc/hoàn tất mock operation đã accept theo ngoại lệ BR-05 | Individual/Admin |
| FR-F01 | P0 Must | Funding preset 100000 VND, quota 500000/user/ngày UTC và 50000000/môi trường/ngày UTC; issuance ledger và DB quota atomic | Demo User/System |
| FR-T01 | P0 Must | P2P transfer giữa hai ví VND hợp lệ, với bước xác nhận | Individual |
| FR-T02 | P0 Must | Không cho phép transfer chính mình, số tiền không hợp lệ hoặc vượt số dư | Individual |
| FR-T03 | P0 Must | Transfer atomic; ledger cân bằng; không overspend khi concurrent | System |
| FR-T04 | P0 Must | Idempotency có terminal replay kể cả business failure; lookup bằng actor/operation/key trước khi có transfer ID; recent commands theo actor | System/Individual |
| FR-H01 | P0 Must | Lịch sử giao dịch phân trang, lọc, chi tiết và trạng thái rõ ràng | Individual |
| FR-L01 | P0 Must | MoneyPostingService là đường duy nhất ghi ledger/projection; append-only và balanced commit guards, unique operation posting | System |
| FR-AU01 | P0 Must | Audit bền vững cho signup, funding, money result và thay đổi trạng thái nhạy cảm; correlation ID, actor, resource, outcome | System |
| FR-RC01 | P0 Must | Reconciliation CLI/test read-only snapshot; phát hiện mismatch, exit khác 0, không tự sửa tiền | Developer/System |
| FR-M01 | P1a Must | Tạo và quản lý merchant profile và merchant wallet | Merchant |
| FR-P01 | P1a Must | Merchant tạo, xem, hủy hoặc để hết hạn payment request | Merchant |
| FR-P02 | P1a Must | Sinh link/QR demo, người trả xác nhận và thanh toán một lần | Merchant/Individual |
| FR-P03 | P1a Must | Quản lý payment status; chống double payment, expiry race | System |
| FR-R01 | P1a Must | Hoàn toàn phần/một phần đồng bộ; thiếu tiền merchant thì FAILED, không pending/debt; tổng không vượt payment | Merchant |
| FR-B01 | P1c Must | Mock deposit/withdraw: hold/settle/release, callback inbox/dedup, timeout giữ hold và NEEDS_REVIEW | Individual |
| FR-N01 | P1b Must | Hiển thị notification và ghi nhận event xử lý bất đồng bộ | User/Merchant |
| FR-I01 | P1b Must | Webhook merchant demo có xác thực, retry và chống xử lý trùng | Merchant |
| FR-AD01 | P1b Must | Admin tra cứu user/wallet/transfer/payment, áp dụng khóa ví có audit | Admin |
| FR-AD02 | P1b Must | Audit log các thao tác nhạy cảm và truy cập điều tra có phân quyền | Admin |
| FR-Q01 | P1b Must | Export CSV lịch sử của chính tài khoản; ownership, filter/row limit và chống spreadsheet formula injection | Individual/Merchant |
| FR-Q02 | P2 Could | Dashboard đối soát, cảnh báo sai lệch ledger/balance | Admin |
| FR-Q03 | P2 Could | Rule-based suspicious transaction flags/limits | System/Admin |
| FR-Q04 | P2 Could | Developer sandbox API và docs tích hợp merchant | Integrator |

## 7. Business Rules & Domain Invariants

### 7.1 Tiền và ví

| ID | Quy tắc |
|---|---|
| BR-01 | NexaPay sử dụng **VND giả lập**, không có giá trị quy đổi/thanh toán ngoài hệ thống. |
| BR-02 | Một ví cá nhân VND/user; một merchant/user và một ví/merchant, owner riêng qua membership. System LedgerAccount không cần user/Wallet. |
| BR-03 | VND nguyên: Java long/DB BIGINT, JSON money là string; không float, fraction, exponent; exact arithmetic và overflow checks. |
| BR-04 | Money command 1–100000000 VND, fee=0; customer/merchant balance tối đa 1000000000000 VND; limits từ backend config. Funding chỉ preset 100000. Khi có hold, max customer balance tính available+held. |
| BR-05 | Customer available không âm. LOCKED chặn P2P/funding/payment/deposit/withdraw mới; vẫn cho xem dữ liệu, nhận refund của payment gốc và hoàn tất callback/hold đã accept. Merchant locked không được khởi tạo refund mới. Issuance/clearing system được signed theo Money Movement Spec. |
| BR-06 | Không được cập nhật số dư mà không có transaction/ledger record tương ứng và lý do nghiệp vụ. |

### 7.2 Transfer và Ledger

| ID | Quy tắc |
|---|---|
| BR-07 | Chuyển tiền nội bộ chỉ thành công khi **cả ghi nợ ví gửi và ghi có ví nhận** cùng hoàn tất. Nếu lỗi giữa chừng, không tạo biến động tiền một phần. |
| BR-08 | Không chấp nhận chuyển cho chính ví nguồn; tài khoản/ví nguồn và đích phải hợp lệ và được phép hoạt động. |
| BR-09 | Với một transfer được post, tổng bút toán có dấu trong cùng loại tiền **bằng 0**; tài khoản hệ thống/clearing phải được tính đúng nếu có funding. |
| BR-10 | Ledger entries đã post là bất biến (append-only); điều chỉnh cần transaction đảo chiều/bù có liên kết chứng từ gốc. |
| BR-11 | Unique actor+operation+key và canonical fingerprint; replay terminal success/business failure giữ nguyên result. Technical rollback không tiêu thụ key. Retain keys suốt dataset; không TTL riêng. |
| BR-12 | Concurrent transfers không thể làm cùng một ví bị overspend. Nếu xảy ra contention/deadlock, server xử lý an toàn và client nhận trạng thái không mơ hồ. |
| BR-13 | Khi client timeout, **không được tự giả định giao dịch thất bại**; client tra cứu trạng thái hoặc retry với cùng idempotency key. |

### 7.3 Demo Funding — nguồn tiền mô phỏng cho P0

**Vấn đề:** Ví ban đầu 0 VND nên không thể trình diễn P2P nếu không có nguồn cấp tiền.

**Quyết định:** `Receive Demo Funds` post DEMO_ISSUANCE `-100000` và ví cá nhân `+100000`. Issuance bắt đầu 0, được âm để biểu diễn phát hành mô phỏng; không seed balance tùy ý. Quota user/môi trường/ngày UTC được lock và cập nhật cùng transaction với ledger/result. UI lấy preset/remaining/nextResetAt từ server. Không có endpoint admin set balance hoặc bỏ qua quota.

Ở P1c thêm **Mock Bank Deposit**; faucet vẫn tồn tại cho demo theo feature flag/quota. Không đồng nhất deposit với faucet. Chi tiết account, hold, callback và recovery ở [Money Movement Spec](NexaPay_MONEY_MOVEMENT_SPEC_v0.2.md).

### 7.4 Merchant Payment / Refund

| ID | Quy tắc |
|---|---|
| BR-14 | Request có nhiều PaymentAttempt nhưng tối đa một Payment thành công; merchant/amount/currency/expiry bất biến. Expiry default 30 phút, min 5 phút/max 24 giờ. Không tự pay merchant mình sở hữu; merchant wallet không nhận P2P tùy ý. |
| BR-15 | Trước khi xác nhận thanh toán, payer thấy tên merchant, số tiền, mô tả, trạng thái và cảnh báo demo. |
| BR-16 | `PAID`, `EXPIRED`, `CANCELLED` là những trạng thái kết thúc không được bị ghi đè tùy tiện; race giữa pay/expire/cancel phải được xử lý nhất quán. |
| BR-17 | Refund chỉ được tạo dựa trên khoản payment đã thành công; tổng refund thành công không vượt số tiền payment gốc. |
| BR-18 | Refund đồng bộ SUCCEEDED/FAILED, đủ tiền merchant mới post; không pending/debt. Chỉ trả về payer gốc, kể cả payer locked. Payment gốc giữ PAID; refundedAmount/refundStatus NONE/PARTIAL/FULL riêng. |
| BR-19 | Webhook có thể đến nhiều lần và không bảo đảm thứ tự; merchant consumer cần cơ chế deduplication. |

### 7.5 Bảo mật và quản trị

| ID | Quy tắc |
|---|---|
| BR-20 | Mọi yêu cầu xem/sửa tài nguyên phải kiểm tra quyền và ownership trên server. |
| BR-21 | Admin không thể sửa/xóa bút toán đã post hay nạp tiền tùy ý bằng việc cập nhật database trực tiếp qua UI. |
| BR-22 | Khóa/mở khóa ví và thao tác quản trị nhạy cảm cần actor, thời điểm, lý do và audit trail. |
| BR-23 | Không log password, token hoặc thông tin nhạy cảm; dữ liệu demo không chứa PII thực tế không cần thiết. |

## 8. State Models (logical, not database schema)

**P2P/Funding (P0)** — DB chỉ commit terminal `SUCCEEDED` hoặc business `FAILED`. `PROCESSING`/`UNKNOWN` là trạng thái UI/request, không một P0 operation IN_PROGRESS đã commit. Technical rollback không tạo FAILED record. Lookup 404 COMMAND_NOT_OBSERVED không chứng minh thất bại; retry cùng key/payload. Business FAILED đã commit được replay dù balance về sau thay đổi.

**Payment Request (P1)** — `PENDING` → `PAID` | `CANCELLED` | `EXPIRED`. Không được quay lại `PENDING`; `PAID` không được đổi thành `EXPIRED` chỉ vì job chạy trễ.

**PaymentAttempt / Refund (P1a)** — terminal `SUCCEEDED` | `FAILED` trong synchronous transaction; không refund pending. Failed attempt không kết thúc PaymentRequest; intent mới có thể thử lại.

**Mock Bank Operation (P1c)** — `PENDING` → `SUCCEEDED` | `FAILED` | `NEEDS_REVIEW`; NEEDS_REVIEW resolve theo provider evidence về SUCCEEDED/FAILED. Sau 15 phút pending cần review, timeout không tự fail/release. POST trả 202 acceptance, replay acceptance gốc; GET operation trả state hiện tại.

**Wallet** — `ACTIVE` | `LOCKED` (các trạng thái bổ sung như `CLOSED` chỉ triển khai sau khi có policy rõ).

## 9. User Stories & Acceptance Criteria (Given / When / Then)

### US-01 — Đăng ký và tạo ví (P0)

**As** a new individual, **I want** to register so that I can use a digital wallet.

- **Given** email chưa tồn tại và dữ liệu hợp lệ, **when** đăng ký thành công, **then** account và ví VND được tạo; ví có số dư ban đầu 0.
- Email trùng/không hợp lệ → thông báo validation an toàn, không tạo tài khoản/ví trùng. Account + wallet + ledger account 0 tạo atomic; signup không được nhận ADMIN từ payload.
- Không gửi email/thu thập giấy tờ; email chỉ đọc sau signup, profile chỉ sửa display name.
- Người chưa đăng nhập không truy cập được dữ liệu ví.

### US-02 — Xem dashboard và lịch sử (P0)

- Đăng nhập đúng tài khoản → chỉ thấy số dư, giao dịch gần đây và lịch sử liên quan tới ví của mình.
- Lịch sử có phân trang, filter tối thiểu theo khoảng thời gian/trạng thái; nhấn một item mở chi tiết với mã giao dịch và số tiền.
- Khi chưa có giao dịch, hiển thị empty state hữu ích; không hiển thị sai số dư khi đang tải.

### US-03 — Cấp tiền demo (P0)

- Trong môi trường demo được phép, user có thể nhận số tiền mô phỏng theo chính sách giới hạn đã cấu hình.
- Một lần cấp tiền thành công tạo transaction + ledger entries đối ứng và cập nhật số dư.
- Nếu vượt giới hạn/bị tắt hoặc lặp request, không cấp tiền vượt quy tắc. Concurrent keys khác nhau vẫn không vượt quota; replay không tính quota lại.
- UI phải ghi rõ đây là **demo funds** không có giá trị thật.

### US-04 — Chuyển tiền thành công (P0)

- **Given** A có đủ tiền và hai ví active, **when** A xác nhận chuyển x VND cho B, **then** A giảm x, B tăng x, giao dịch `SUCCEEDED` và bút toán cân bằng.
- User nhìn thấy người nhận, số tiền trước khi xác nhận và thấy transaction ID sau khi hoàn tất.
- B có thể xem giao dịch nhận tiền trong lịch sử của mình.

### US-05 — Chuyển tiền không hợp lệ/thiếu tiền (P0)

- Số tiền <= 0, người nhận không tồn tại, tự chuyển, ví khóa hoặc vượt số dư → bị từ chối; không có thay đổi số dư.
- Thông báo lỗi không lộ thông tin riêng tư không cần thiết; form cho phép chỉnh sửa và thử lại.

### US-06 — Duplicate/timeout/concurrent transfer (P0)

- Hai request có cùng idempotency key và payload → **chỉ một transfer thành công**, cùng kết quả có thể truy xuất lại.
- Key trùng nhưng payload khác → lỗi có thể xử lý rõ ràng, không tạo giao dịch mới.
- Hai chuyển tiền cạnh tranh khiến tổng lớn hơn số dư → không thể cùng thành công; không có ví âm/ledger lệch.
- Client timeout → lookup theo actor/operation/key khi chưa có transaction ID; 404 chưa quan sát được không là FAILED. Retry **đúng key/payload**.
- Insufficient funds đã commit, rồi funding: key cũ replay lỗi cũ; user bắt đầu intent mới mới tạo key mới.
- Crash trước commit rollback toàn bộ; mất response sau commit vẫn lookup/replay một resource cũ. Re-auth cùng user không đổi scope key.

### US-07 — Merchant tạo Payment Request (P1a)

- Merchant active tạo yêu cầu có số tiền, mô tả, thời hạn → nhận mã, link và QR demo.
- Merchant chỉ xem/hủy yêu cầu của mình; khi quá hạn, không được thanh toán mới.
- Payment request hiển thị số tiền và trạng thái nhất quán ở cả payer/merchant.

### US-08 — Người dùng thanh toán Merchant (P1a)

- User mở link hợp lệ, thấy thông tin merchant → xác nhận trả tiền → ví payer giảm, ví merchant tăng, payment thành `PAID`, ledger cân bằng.
- Không thể pay request đã `PAID`/`EXPIRED`/`CANCELLED` hoặc khi thiếu tiền.
- Hai lần xác nhận/callback trùng không nhân đôi tiền; merchant xem được kết quả.

### US-09 — Merchant hoàn tiền (P1a)

- Merchant được phép tạo refund cho payment đã `PAID`, số tiền dương và không vượt số chưa hoàn.
- Refund thành công tạo bút toán đảo chiều và xuất hiện trong lịch sử của hai bên.
- Refund nhiều lần/đồng thời không vượt tổng payment; lỗi không làm thay đổi tiền một phần. Merchant thiếu tiền → FAILED; payer locked vẫn nhận refund hợp lệ. Original payment vẫn PAID, UI phản ánh PARTIAL/FULL riêng.

### US-10 — Mock deposit/withdrawal (P1c)

- User khởi tạo yêu cầu hợp lệ → thấy trạng thái `PENDING` cho tới khi mock provider xác nhận.
- Deposit success post tiền đúng một lần. Withdrawal accept đã post PERSONAL→HOLD; provider success post HOLD→CLEARING, failure post HOLD→PERSONAL đúng một lần. Với total=100000, rút pending 80000 thì available=20000/held=80000, không P2P được 50000.
- Timeout giữ hold, không giả FAILED/release; pending >15 phút → NEEDS_REVIEW. Duplicate/old callback không lùi state; terminal mâu thuẫn audit/review, không tự post bù.

### US-11 — Admin kiểm tra giao dịch (P1b)

- Admin có thể lọc và xem giao dịch theo mã/trạng thái/khung thời gian với audit context cần thiết.
- Admin không thể truy cập dữ liệu ngoài phạm vi role được cấp; user thông thường không xem được admin endpoints.
- Khóa ví yêu cầu lý do, có audit; thao tác bị từ chối nếu không có quyền.

### US-12 — Notification/Webhook (P1b)

- Một payment thành công tạo notification/event cho các bên liên quan; lỗi gửi notification **không rollback** giao dịch đã thành công.
- Webhook có retry theo chính sách, chứa event ID duy nhất và xác thực; retry không làm phát sinh payment lần hai.
- Merchant có thể kiểm tra trạng thái qua API/dashboard khi webhook thất bại.

### US-13 — Audit và reconciliation nền tảng (P0)

- Cùng snapshot, mọi account projection bằng tổng entries; successful operation có đúng một ledger transaction; business FAILED không có ledger.
- CLI trả exit code khác 0 khi cố ý tạo fixture lệch; không tự sửa balance/ledger. Concurrent commit không gây false mismatch.
- Commit guard từ chối ledger lệch/thiếu entries/currency sai; app role không UPDATE/DELETE posted ledger.

## 10. UI/UX Requirements

### 10.1 Sitemap cấp sản phẩm (dự kiến)

| Surface | Trang chính | Mục tiêu UX |
|---|---|---|
| **Public** | Home/Landing, Sign up, Sign in | Giới thiệu rõ app demo, CTA dễ hiểu |
| **Wallet** | Overview, Send Money, Transfer Review/Result, Transactions, Transaction Detail, Profile/Settings | Tiền, người nhận, trạng thái rõ; hoàn thành task nhanh |
| **Business** (P1) | Overview, Payment Requests, Create Request, Payment Detail, Transactions, Refunds, Settings | Theo dõi tiền về, sao chép link/QR, không nhầm paid/pending |
| **Console** (P1) | Overview, Users, Wallets, Transactions, Audit/Investigations, Settings | Tra cứu và điều tra có filter/search tốt |

### 10.2 Design direction

- **Brand:** NexaPay (tên tạm; chưa xác minh nhãn hiệu); Deep Teal `#102E37`, Mint `#5FE0C2`; typography sans-serif rõ ràng.
- **Style:** Modern Fintech Minimalism + Fluent Design principles, không sao chép nguyên mẫu giao diện thương mại nào.
- Responsive: user portal ưu tiên mobile web; merchant/admin ưu tiên desktop nhưng vẫn dùng được ở tablet/mobile.
- Có design tokens/components dùng chung cho typography, button, form, input, card, table, dialog, toast, badge, status chip.
- Mỗi page có loading/empty/error/success states; form có validation và thông báo lỗi gần trường.
- Transfer/Payment phải có **review screen** hiển thị số tiền và đối tượng trước khi người dùng xác nhận.
- Pending ≠ Success; không dùng màu hoặc biểu tượng thành công khi giao dịch còn chưa xác định.
- Số tiền format VND thống nhất; giờ hiển thị theo locale/timezone người dùng và lưu dữ liệu thời gian chuẩn.
- UX an toàn: hạn chế double-click tạo request mới; vẫn phải có idempotency ở backend.
- Accessibility: mục tiêu WCAG 2.2 AA; keyboard/focus/contrast, zoom/reflow, accessible auth; chưa tuyên bố certification. Tiếng Việt và light theme P0.

## 11. Non-functional Requirements & Quality Targets

| ID | Category | Yêu cầu nghiệm thu baseline |
|---|---|---|
| NFR-01 | Security | Không đọc/sửa dữ liệu ví khác khi không có quyền; password được hash an toàn; session/token được bảo vệ; không log secrets |
| NFR-02 | Transaction integrity | 100% automated invariant checks trong các test scenarios có kiểm soát: không double-posting, không overspend, ledger cân bằng |
| NFR-03 | Reliability | Retry với cùng idempotency key không tạo thêm giao dịch; lỗi thông báo/webhook không thay đổi giao dịch đã post |
| NFR-04 | Auditability | Audit durable từ P0; cùng commit cho money result và admin mutation; login failure logs riêng không có credentials |
| NFR-05 | Test coverage | Có unit + integration tests cho transfer/ledger/authorization; có E2E smoke test cho luồng chính |
| NFR-06 | Performance | Lock wait 2s/statement 5s, tối đa 2 retries trong tổng server command budget 20s; client timeout 30s. Đây là budgets, không là số đo; benchmark p95/throughput gắn môi trường thực trước mọi claim |
| NFR-07 | Maintainability | Mã nguồn module hóa, migration versioned, lint/format và CI chạy test |
| NFR-08 | Deployability | Cài đặt local theo README, seed demo, lệnh chạy/test rõ; có public demo khi điều kiện hosting cho phép |
| NFR-09 | Usability | Hoàn thành transfer trong luồng rõ ràng; lỗi, empty/pending/success có thông điệp riêng, responsive |
| NFR-10 | Privacy | Chỉ dữ liệu giả; không directory/email search người dùng; recipient lookup exact wallet ID; không công khai admin credentials/tokens/PII |

**Đo lường cụ thể ở bước test plan:** số concurrent clients, dataset size, hardware, response-time budgets và failure-injection scenarios phải được ghi kèm để kết quả benchmark có ý nghĩa.

## 12. Edge Cases / Risk Scenarios cần có test

| Case | Kỳ vọng sản phẩm |
|---|---|
| A chuyển tiền cùng lúc từ hai thiết bị | Không làm âm ví, không double-spend |
| Client click 2 lần / retry sau timeout | Một thao tác nghiệp vụ nếu cùng idempotency intent |
| App crash giữa lúc chuyển tiền | Không có trạng thái A bị trừ nhưng B chưa nhận trong một transfer đã post |
| User bị khóa ngay khi đang chuyển tiền | Quy tắc tại ranh giới transaction quyết định nhất quán; không có partial commit |
| User xem transaction ID của người khác | Không rò rỉ dữ liệu/ownership denied |
| Merchant payment hết hạn đúng lúc payer xác nhận | Chỉ một trạng thái kết thúc hợp lệ, không vừa PAID vừa EXPIRED |
| Merchant refund hai lần đồng thời | Tổng số tiền refund không thể vượt payment |
| Webhook/notification worker down | Payment không bị mất; callback có thể xử lý lại an toàn |
| Mock bank callback gửi lặp / sai thứ tự | Không nạp/rút trùng, kết quả trạng thái hợp lệ |
| Admin cố sửa balance thủ công | Không có chức năng trực tiếp; cần nghiệp vụ bù có audit |

## 13. MVP Definition of Done & Demo Scenarios

**P0 không được coi là hoàn thành nếu chỉ có trang CRUD và API trả 200.** Cần đủ các điều kiện:

1. Có thể tạo hai tài khoản test và hai ví mặc định 0 VND.
2. Có thể cấp demo funds có truy vết ledger theo policy test/demo.
3. Chuyển A → B thành công với số dư chính xác và lịch sử ở cả hai phía.
4. Chuyển tiền thiếu số dư, tự chuyển, ví khóa bị từ chối không đổi balance.
5. Automated tests chứng minh một request lặp không tạo duplicate transfer và concurrent transfer không overspend.
6. UI hoạt động tốt trên desktop/mobile browser; có loading/error/success states, review và transaction detail.
7. Backend có validation, authz, migration và integration tests; CI build/test chạy thành công.
8. Docker/local setup tái lập được, README và tài khoản demo không chứa secret thật.
9. Money Movement gates MM-01–08 đạt; audit nền tảng và reconciliation CLI có report; tests trực tiếp DB guards với app role.
10. Session/CSRF/logout, lookup chưa có transaction ID, refresh/re-auth recovery và account cache isolation được kiểm thử; không fake success.

**P1a Done:** Merchant onboarding/payment link/QR, failed attempts không khóa request, tối đa một capture; full/partial refund đủ tiền, pay/expire/cancel/refund races đạt MM-09.

**P1b Done:** Transactional outbox crash recovery, webhook/in-app retry/dedup, Console ownership/lock/audit investigation, CSV export an toàn. Public demo được smoke test nếu triển khai; thiếu ngân sách không được ghi claim đã deploy.

**P1c Done:** Deposit/withdraw hold/settle/release, inbox/callback/review và MM-10–11 đạt. P1 complete chỉ khi a/b/c hoàn tất; các gate là nghiệm thu dự kiến, chưa có kết quả.

## 14. Success Metrics & Portfolio Evidence

- **Product completion:** Các user journeys J-01/J-02 ở P0 và J-03/J-04 ở P1 chạy end-to-end.
- **Correctness evidence:** Bộ test mô tả rõ số lượng concurrent requests, invariants, và kết quả thực tế.
- **Reliability evidence:** Demo duplicate idempotency key, timeout recovery, refund over-limit và webhook retry.
- **UX evidence:** Screenshots/walkthrough của Wallet, Business, Console với responsive states.
- **Engineering evidence:** README, sơ đồ tổng quan, ADR, test reports, CI pipeline, deployment notes, benchmarks đã thực sự đo.

Không gắn các con số như `99.99% uptime`, `10k TPS`, `100% secure` vào CV khi chưa có phương pháp đo/kiểm chứng.

## 15. Dependencies, Risks & Assumptions

### 15.1 Baseline decisions

- Một currency VND giả lập; không phí giao dịch ở giai đoạn đầu.
- Một người dùng có một ví cá nhân chính; merchant có ví riêng.
- Email/password + session cookie same-origin + CSRF; 30 phút idle/8 giờ absolute. P0 chưa có email verification/reset/change password, OIDC hoặc 2FA; xem ADR-001 về giới hạn demo.
- Một React app theo role routes; một Spring Boot backend; một PostgreSQL database.
- Demo funding có giới hạn để khởi tạo tiền mà không yêu cầu mock bank đầy đủ trong P0.

### 15.2 Rủi ro chính

| Risk | Tác động | Hướng giảm thiểu |
|---|---|---|
| Scope creep: 3 portals + merchant + banking + analytics | Trễ tiến độ, thiếu chất lượng | Duyệt P0 trước, P1 triển khai theo vertical slices |
| Sai nghiệp vụ tiền | Lỗi nghiêm trọng nhất về kỹ thuật | Ghi rõ invariants + concurrency tests trước khi mở rộng |
| Thiết kế auth thiếu chắc chắn | Lộ dữ liệu/chiếm quyền trong demo | Threat review cơ bản, least privilege, authorization tests |
| Overengineering với microservices/Kafka | Nhiều phần vận hành nhưng ít giá trị demo | Modular Monolith, chỉ thêm messaging có use case |
| UI đẹp nhưng nghiệp vụ nông | CV thiếu giá trị Middle Backend | Tập trung 3 bài toán: atomic transfer, idempotency, reliable events |
| Public demo dùng tài khoản dữ liệu nhạy cảm | Rủi ro privacy/security | Seed accounts giả, rate limits, không thu thập dữ liệu thật |

## 16. Decision register và thông tin kế hoạch

| Câu hỏi v0.1 | Quyết định v0.2 |
|---|---|
| R1 | P0 Wallet/P2P, sau đó P1a merchant/refund, P1b operations, P1c mock bank |
| R2 | VND nguyên, một ví personal/user, một ví/merchant; system accounts tách biệt |
| R3 | DEMO_ISSUANCE ledger + preset/quota DB, không admin set balance |
| R4 | Một login personal + merchant; một owner/merchant và một merchant/user P1 |
| R5 | Full/partial refund đồng bộ; thiếu merchant funds thì FAILED |
| R6 | QR chỉ payment URL nội bộ, không VietQR/thẻ/ngân hàng thật |
| R7 | Spring Security HTTP session, cookie+CSRF same-origin, không OIDC P0 |
| R8 | Local/CI trước, public demo sau P0 quality gate khi có host phù hợp |
| R9 | Chưa có ngân sách/giờ mỗi tuần/deadline; không tự đặt lịch/cam kết chi phí, không chặn P0 local |
| R10 | Tiếng Việt trước; i18n-ready, English sau |

Các quyết định thiết kế trên đã Accepted theo ủy quyền của chủ dự án; ADR-001 ghi trade-offs/defaults. Brand asset export, dependency pin, chi tiết DDL/OpenAPI là deliverables theo slice, không yêu cầu chờ duyệt lại R1–R10.

## 17. Handoff Rules for Codex

1. PRD này là nguồn để tạo backlog/use-case specs, **không phải lệnh lập tức viết code**.
2. Mỗi task triển khai phải tham chiếu ít nhất một `FR-*` và acceptance criteria tương ứng; không tự thêm tính năng ảnh hưởng tiền/quyền truy cập mà không có yêu cầu.
3. Các rule `BR-*`, bất biến ledger và ownership là yêu cầu nền, không được bỏ qua vì lý do rút ngắn.
4. Baseline đã chốt ở ADR-001/Money Movement Spec: bắt đầu DDL/OpenAPI và tests của P0, không đợi phê duyệt lại. Không thêm Kafka/Redis/Keycloak hoặc thay isolation/money model mà không ADR mới.
5. Đối chiếu PRD (scope/rules), ADR (decisions), Money Movement (behavior), Architecture và UI. Mâu thuẫn mới ảnh hưởng money/security phải được giải quyết và cập nhật docs trước code liên quan; không dựng exception ngầm.
6. Phát triển từng end-to-end vertical slice có test; thông số benchmark và trạng thái công việc phải dựa trên kết quả thực tế.

## 18. Baseline và changelog

- **Sản phẩm:** NexaPay, web wallet + merchant payment platform mô phỏng.
- **Người dùng:** individual, merchant, admin; developer integrator sau.
- **MVP:** identity + demo funding có ledger + wallet + P2P transfer + transaction history + reliable transaction tests.
- **P1:** P1a merchant payment/refund → P1b outbox/webhook/Console/CSV → P1c mock bank/hold.
- **P2:** reconciliation dashboard, risk rules UI, performance/observability nâng cao, integrations/PWA.
- **Nguyên tắc:** không tiền thật, correctness trước, web-first/API-first, modular monolith, product UX đẹp.

---

**v0.2 — 2026-11-01:** Chốt R1–R8/R10; R9 là ràng buộc kế hoạch. Giữ IDs FR/BR/US hiện có, thêm FR-AU01/FR-RC01/US-13; cập nhật FR-W03/F01/T04/L01/R01/B01/Q01, BR-02–05/11/14/18, US-01/03/06/09/10 và NFR-04/06/10. Chia gates P1a/b/c, thêm reconciliation P0 và recovery contract. Thay đổi tiếp theo cần changelog và ADR khi ảnh hưởng quyết định.
