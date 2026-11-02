# NexaPay

Ví VND mô phỏng dùng Java 21 / Spring Boot, PostgreSQL và React / Fluent UI v9
(Fluent 2). Chỉ dùng dữ liệu giả; không có tiền hay kết nối ngân hàng thật.

P0-01 triển khai đăng ký và tạo ví 0 VND atomic, đăng nhập/session/CSRF, xem ví,
sửa tên hiển thị và đăng xuất. P0-02 bổ sung funding 100.000 VND có quota,
ledger/idempotency atomic, tra cứu kết quả và reconciliation CLI. P0-03 bổ sung
chuyển tiền P2P và lịch sử/chi tiết có phân quyền; evidence nghiệm thu trong
[plan P0-03](<Implementation Plan/P0-03-p2p-history.md>). P0-04 bổ sung 5 giao dịch
mới nhất trên Tổng quan, quick actions theo trạng thái ví và
[ma trận nghiệm thu P0](<Implementation Plan/P0-04-overview-release-readiness.md>).
P0 Wallet MVP đã nghiệm thu local và
[GitHub Actions](https://github.com/anhkhuong04/NexaPay/actions/runs/41402042152):
50 backend, 26 frontend unit, 22 desktop/mobile E2E; reconciliation 0 findings.

## Chạy local

Cần Java 21, Node 22.18+, Docker/Compose. Maven Wrapper có sẵn, không cần Maven
toàn cục. Chạy từ root với PowerShell:

```powershell
Copy-Item .env.example .env
docker compose --env-file .env -f infra/compose.yaml --profile app up --build -d
```

Mở http://127.0.0.1:8080. Không có tài khoản seed; tự đăng ký, ví dụ
`alice@example.test`. `.env.example` chỉ chứa mật khẩu giả cho local, không dùng
cho public hosting. PostgreSQL local ở `127.0.0.1:5442`, app ở `127.0.0.1:8080`.
Đổi `DB_PORT` / `APP_PORT` trong `.env` nếu cổng bận. Không xoá volume để sửa lỗi.

```powershell
docker compose --env-file .env -f infra/compose.yaml logs --tail 100 app
docker compose --env-file .env -f infra/compose.yaml stop
```

Dữ liệu vẫn nằm trong volume `pgdata`. Nếu thay mật khẩu `.env` sau khi DB đã
khởi tạo, cần đổi credential trong PostgreSQL tương ứng; sửa env không tự đổi role.

## Phát triển

Chỉ chạy database nếu muốn dùng Vite và Spring Boot riêng:

```powershell
docker compose --env-file .env -f infra/compose.yaml up -d --wait db
# Load các biến local, không in credential.
Get-Content .env | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object {
  $pair = $_ -split '=', 2
  [Environment]::SetEnvironmentVariable($pair[0], $pair[1], 'Process')
}
./backend/mvnw.cmd -f backend/pom.xml spring-boot:run '-Dspring-boot.run.profiles=local'
```

Terminal khác: `cd frontend`, `npm ci`, `npm run dev`. Vite proxy `/api` đến
`127.0.0.1:8080`; browser dùng một origin. Nếu đổi DB_PORT, đặt DB_URL tương ứng
cho Java (`jdbc:postgresql://localhost:<port>/nexapay`). Không bật profile `local`
trên public host: profile này cho phép session cookie trên HTTP loopback.

## Kiểm chứng

```powershell
cd frontend
npm ci
npm run format:check
npm run lint
npm run test
npm run build
npm audit --audit-level=moderate
cd ../backend
./mvnw.cmd -B -ntp -Pweb verify
```

Backend tests cần Docker để chạy PostgreSQL Testcontainers; không thay bằng H2.
Profile Maven `web` đóng gói `frontend/dist` vào JAR; luôn build frontend trước.
Linux dùng `./mvnw`. Docker image build bỏ chạy tests bên trong build container;
các kiểm thử bắt buộc chạy riêng bằng lệnh `verify` ở trên và trong CI.

E2E cần app/DB thật đang chạy tại 8080 (Compose hoặc JAR đã bundle SPA):

```powershell
cd frontend
node ./node_modules/@playwright/test/cli.js install chromium
npm run test:e2e
```

Desktop/mobile Chromium, axe, keyboard và reflow; reports tại
`frontend/playwright-report/`, screenshots/trace tại `frontend/test-results/`.
Backend reports tại `backend/target/surefire-reports/`. CI định nghĩa cùng gates
trong [.github/workflows/ci.yml](.github/workflows/ci.yml).

Từ root, `node infra/runtime-smoke.mjs` tự khởi động/dừng JAR ở cổng 18081 để
kiểm tra SPA/API routing, session mất hiệu lực sau restart, kết quả P2P/lookup/
replay/history cùng merchant/wallet/membership cùng payment/refund lookup/replay và original-payer history vẫn còn và cookie
Secure mặc định. Cần `.env`, database đang chạy và JAR đã bundle SPA. Script tạo
tài khoản giả riêng; không reset database. Có thể đổi `SMOKE_PORT` nếu cần.
Nếu app chạy ở cổng khác, đặt `E2E_BASE_URL` tương ứng trước khi chạy E2E.

Scripts gọi Node CLI trực tiếp để chạy được cả khi đường dẫn checkout chứa `&`
trên Windows. Lockfile pin dependencies. Override `minimatch` 11.0.1 áp dụng bản
vá [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)
cho các công cụ lint; lint/tests/build kiểm tra khả năng tương thích.

## Ranh giới dữ liệu và bảo mật

Một Spring Boot instance phục vụ SPA/API cùng origin; HTTP session nằm trong
memory nên restart yêu cầu đăng nhập lại, user/ví vẫn lưu trong PostgreSQL.
Idle timeout 30 phút, absolute lifetime 8 giờ; BCrypt cost 12. Cookie mặc định
HttpOnly/Secure/SameSite=Lax. CSRF áp dụng cả login/signup/logout và PATCH.
Không có JWT trong browser storage hoặc public API cấp quyền/admin/sửa balance.

Flyway dùng owner, runtime dùng role hạn chế: không sửa balance hay xoá/sửa audit.
Opening balance do DB mặc định 0, không tạo journal giả. Tiền trong JSON là chuỗi
số nguyên. Funding post issuance âm/personal dương với journal cân bằng và guards
ở commit; LOCKED wallet vẫn đọc được nhưng không nhận funding mới.
Login throttle trong memory chỉ dành cho một instance; forwarded IP chưa được tin cậy.
API body giới hạn 16 KiB cả khi không có Content-Length; vượt ngưỡng trả JSON 413.

## Cấp tiền demo và đối soát

Mở “Nhận tiền demo”, xem khoản cấp/quota và xác nhận. Preset 100.000 VND/lần,
500.000 VND/user/ngày UTC, 50.000.000 VND/môi trường/ngày UTC. Ngoài profile local,
funding mặc định tắt; bật có chủ ý bằng `NEXAPAY_FUNDING_ENABLED=true`.
Compose này dành cho local và bật flag theo `.env` (mặc định true); có thể tắt
bằng `NEXAPAY_FUNDING_ENABLED=false` rồi recreate app. Không dùng cấu hình local
như một public deployment đã được kiểm chứng.

Mỗi intent dùng một UUID Idempotency-Key. 201 thành công hoặc 422 từ chối đã lưu;
technical rollback không tạo FAILED operation. Sau timeout/re-auth/reload, tra cứu
cùng mã ở màn funding hoặc “Thao tác đã lưu”; 404 chưa quan sát được không chứng
minh thất bại. Reload không tự POST, logout/xuất sang actor khác xoá context; re-auth
cùng actor giữ reference để lookup. Draft tiền giữ trong memory qua re-auth cùng
actor để retry thủ công đúng key/payload; reload mất draft, chỉ còn lookup.

CLI read-only, REPEATABLE READ snapshot, không repair; findings trả exit khác 0:

```powershell
Get-Content infra/reconcile.sql -Raw | docker compose --env-file .env -f infra/compose.yaml exec -T db psql -U nexapay_app -d nexapay
if ($LASTEXITCODE -ne 0) { throw 'Reconciliation failed; investigate reported IDs' }
```

Linux: `docker compose --env-file .env -f infra/compose.yaml exec -T db psql -U nexapay_app -d nexapay < infra/reconcile.sql`.
Hiện kiểm tra journal/projection/funding/transfer/payment/refund/command/quota/issuance và merchant/request/attempt linkage.
Không xoá volume hay sửa balance để làm report xanh.

## Tài liệu

- [Baseline và chỉ mục](Docs/README.md)
- [Plan, acceptance và kết quả P0-01](<Implementation Plan/P0-01-identity-wallet.md>)
- [Plan và evidence P0-02](<Implementation Plan/P0-02-demo-funding.md>)
- [Plan và evidence P0-03](<Implementation Plan/P0-03-p2p-history.md>)
- [Overview, nghiệm thu P0-04 và roadmap P1a](<Implementation Plan/P0-04-overview-release-readiness.md>)
- [OpenAPI](Docs/api/p0-01.openapi.yaml)
- [OpenAPI funding/commands](Docs/api/p0-02.openapi.yaml)
- [Wireframes và trạng thái UI](Docs/ui/P0-01-wireframes.md)
- [Quy tắc agent](AGENTS.md)

## Chuyển tiền và lịch sử P0-03

Người nhận chia sẻ mã ví UUID từ Tổng quan. Mở “Chuyển tiền”, tra cứu đúng mã,
kiểm tra tên/ví nhận rồi nhập số tiền và lời nhắn. Chỉ bước “Xác nhận chuyển” gửi
lệnh; phí 0 VND, số tiền 1..100.000.000 VND, total balance tối đa
1.000.000.000.000 VND. Input nhận digits hoặc grouping chấm vi-VN (`10.000`),
không chấp nhận dấu phẩy/thập phân/exponent. Lời nhắn NFC/trim, tối đa 140 Unicode
code points, không control characters. Không dùng email để tra cứu người nhận.

Server xác định ví gửi từ session, khóa hai accounts theo UUID, kiểm tra trạng
thái/số dư và ghi hai ledger entries cùng transaction với command/audit. Self,
recipient không tồn tại, ví LOCKED, thiếu số dư hoặc vượt balance limit là 422
FAILED đã lưu; thêm tiền/unlock không thay kết quả cũ. Lỗi kỹ thuật rollback,
không giả FAILED. Throttle chung funding/P2P 30 requests/phút/actor; lookup người
nhận có bucket riêng 30/phút. Runtime vẫn không có quyền sửa posted_balance.

“Lịch sử giao dịch” lọc incoming/outgoing/funding, status và ngày UTC (hai ngày
inclusive trên UI, API `[from,to)`). Timestamp hiển thị local kèm timezone;
newest-first cursor có tie-break UUID. Người nhận chỉ thấy incoming SUCCEEDED;
FAILED chỉ người gửi, tài khoản khác nhận 404. Detail không chứa email/command key.
CLI reconciliation kiểm tra cả funding và P2P, projection/journal/linkage/quota/
issuance trong snapshot read-only; findings không được sửa tự động.


## Merchant onboarding & wallet — P1a-01

**VERIFIED:** 60 backend / 34 frontend unit / 28 E2E; runtime smoke và đối soát
0 findings; [GitHub Actions](https://github.com/anhkhuong04/NexaPay/actions/runs/41408005480).

Sau khi đăng nhập, chọn “Doanh nghiệp” trong workspace switcher và nhập tên giả.
Onboarding tạo merchant ACTIVE, OWNER membership và ví merchant 0 VND trong cùng
transaction với audit. Một user chỉ có một merchant; request trùng trả 409 và
không tạo thêm ví. Nếu mất response, dùng “Kiểm tra doanh nghiệp đã tạo” để đọc
kết quả đã lưu trước khi gửi lại; reload không tự tạo merchant.

Business Overview đọc ví merchant riêng; Settings cho đổi tên doanh nghiệp. Có
thể chuyển lại “Ví cá nhân” bất kỳ lúc nào. `/wallets/me`, funding/P2P và lịch sử
P0 vẫn thuộc personal workspace; ví merchant không nhận tiền demo hoặc P2P. API
business luôn kiểm OWNER membership từ database, không dùng role/ownerId client.
Session summary phản ánh membership ngay sau onboarding và sau đăng nhập lại;
không cấp ADMIN. Không có KYC/staff/multi-merchant trong baseline.

V4 migration nâng cấp dữ liệu P0, giữ IDs/ledger/history; không sửa V1–V3 hoặc
reset volume. Runtime vẫn không được sửa posted_balance trực tiếp; MERCHANT có
cùng nonnegative/max balance guard với PERSONAL. Reconciliation bổ sung kiểm
merchant ownership/account type và giữ toàn bộ checks funding/P2P/quota/issuance.

P1a-01 bàn giao
onboarding/profile/wallet. Xem [plan/evidence](<Implementation Plan/P1a-01-merchant-wallet.md>),
[OpenAPI](Docs/api/p1a-01.openapi.yaml) và [UI states](Docs/ui/P1a-01-merchant-wireframes.md).


## Payment Request & Checkout — P1a-02

**VERIFIED:** 74 backend / 44 frontend unit / 36 E2E, runtime restart và
reconciliation **0 findings**; [GitHub Actions](https://github.com/anhkhuong04/NexaPay/actions/runs/41415594033).

Doanh nghiệp → “Yêu cầu thanh toán” → “Tạo yêu cầu”: nhập số tiền 1..100.000.000
VND, mô tả và thời hạn 5 phút..24 giờ (mặc định30 phút). Detail cung cấp URL cùng
origin và QR; chỉ yêu cầu PENDING có thể hủy qua bước xác nhận. Metadata immutable,
muốn đổi nội dung phải tạo yêu cầu mới. Mất phản hồi tạo request thì tra cứu key
đã lưu; không tự tạo lại sau reload.

Người trả mở link `/pay/:ref`, xem merchant/amount/expiry trước đăng nhập. Đăng
nhập trở lại đúng checkout, xem số dư cá nhân, review rồi mới xác nhận trả tiền.
Mỗi request tối đa một capture; thiếu tiền/locked/self-payment là FAILED attempt
đã lưu, không biến request thành FAILED. Intent mới chỉ bắt đầu sau kết quả
terminal. Timeout/re-auth/reload dùng command lookup trước, không auto POST.

Payment ghi hai ledger legs personal→merchant, request PAID, attempt/payment,
command result và audit trong cùng transaction. Request lock và actual DB clock
quyết định expiry, accounts lock UUID tăng dần. Public DTO không chứa payer/key/
account metadata. Payer thấy failed/successful attempts trong lịch sử cá nhân;
merchant chỉ thấy successful captures và số liệu thực theo ngày UTC. Throttle
money commands dùng chung funding/P2P/PAYMENT/REFUND. Refund được bổ sung trong P1a-03 bên dưới.

V5 additive đã kiểm chứng giữ dữ liệu V4; không reset volume. Xem
[plan/evidence](<Implementation Plan/P1a-02-payment-checkout.md>),
[OpenAPI](Docs/api/p1a-02.openapi.yaml) và
[UI states](Docs/ui/P1a-02-payment-wireframes.md).


## Full/Partial Refund — P1a-03

**VERIFIED:** 85 backend / 51 frontend unit / 44 E2E; packaged refund
lookup/replay/history sau restart PASS, reconciliation **0 findings**;
[GitHub Actions](https://github.com/anhkhuong04/NexaPay/actions/runs/41441983900). P1a DoD/MM-09 đã đóng;
P1b tiếp theo, xem plan/evidence.

Từ request đã thanh toán hoặc “Thanh toán đã nhận”, chọn “Hoàn tiền”. Form hiển
thị tiền gốc/đã hoàn/còn được hoàn và payer gốc. Nhập một phần hoặc chọn “Hoàn
toàn bộ phần còn lại”, xem lại số tiền/lý do/phí/ví nguồn rồi xác nhận. Lịch sử
và chi tiết riêng ở `/business/refunds`; payer thấy incoming refund thành công
trong ví cá nhân. Payment/request giữ PAID; NONE/PARTIAL/FULL được tính riêng.

Merchant ACTIVE và ví nguồn không khóa, đủ tiền mới post. Payer gốc LOCKED vẫn
được nhận refund; không đổi destination bằng client input. Payment lock→accounts
UUID order, aggregate guard và unique command ngăn hoàn vượt gốc hoặc post lặp.
Refund FAILED giữ nguyên khi replay; thiếu tiền không thành pending/debt. Khi
mất phản hồi/re-auth/reload phải lookup trước; payload chỉ ở memory, reload
lookup-only và không tự gửi POST. Không có endpoint arbitrary merchant outflow.

V6 additive giữ dữ liệu V5, CLI đối soát thêm refund/original capture/command/
reverse legs/aggregate/orphan journal. Xem [plan/evidence](<Implementation Plan/P1a-03-refunds.md>),
[OpenAPI](Docs/api/p1a-03.openapi.yaml), [UI states](Docs/ui/P1a-03-refund-wireframes.md).
P1b notification/webhook/Console/CSV chưa thuộc increment này.
